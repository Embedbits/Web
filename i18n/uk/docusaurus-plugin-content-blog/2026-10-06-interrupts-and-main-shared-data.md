---
title: "Interrupts and main(): how to share data safely"
slug: interrupts-and-main-shared-data
date: 2026-10-06T14:00:00
authors: [Mr.Nobody]
tags: [embedded, c, stm32]
---

An interrupt handler and the main loop are two programs that run in the same memory and do not know about each other. The C compiler does not know that the interrupt exists, and the CPU does not know that two variables belong together. The programmer is the only one who knows, and the bugs that follow are the worst kind: they appear once in a thousand runs, they disappear when you attach the debugger and they never appear in the code review, because the code looks right.

This article goes through the three problems of the shared data, one by one, with the code that **fails**, and then shows the patterns that work. The experiments run on a Cortex-M4 (in QEMU, on a model of an STM32F4 board) or on a PC, and the outputs are real.

<!-- truncate -->

## Problem 1: the compiler does not see the interrupt

The simplest communication between an interrupt and the main loop is a flag. The interrupt sets it, the main loop waits for it:

```c title="main.c (a part)"
#ifdef USE_VOLATILE
static volatile bool dataReady;
#else
static bool dataReady;
#endif

void SysTick_Handler(void)
{
    dataReady = true;
}

int main(void)
{
    SysTick_Start(1000u);

    while (!dataReady)
    {
        /* waiting for the interrupt */
    }

    Print("the interrupt was seen\n");
    Quit();
    return 0;
}
```

This is the whole program, and with the optimization `-O2` it **never finishes**. I ran it in QEMU with the SysTick as the interrupt source (the interrupt fires and sets the flag), and compared the version with and without `volatile`:

```text
--- without volatile
(no output, the program was killed by the timeout after 5 s)
--- with volatile
the interrupt was seen
```

Why? Look at what the compiler generated for the loop in the first version:

```text
 8000062:  ldrb  r3, [r1, #0]       @ read the flag once
 8000064:  cbnz  r3, 8000068        @ non-zero: leave the loop
 8000066:  b.n   8000066            @ zero: jump to itself, forever
```

The compiler reasons about the code of `main()` alone, and in that code nobody writes to `dataReady`. So the value cannot change, it is enough to read it once, and the loop becomes an infinite loop. Exactly what you asked for, from its point of view. With `volatile` the compiler has to read the variable from the memory at every pass:

```text
 8000062:  ldrb  r3, [r2, #0]       @ read the flag in every pass
 8000064:  cmp   r3, #0
 8000066:  beq.n 8000062
```

The lesson: **every variable that is shared between an interrupt and the main code has to be `volatile`.** The same is true for every register of a peripheral, which is the reason why the register definitions in the CMSIS headers are `volatile`. Keep in mind that this works in the debug build (`-O0`) without it, and fails in the release build, which is why the bug is found late.

## Problem 2: `volatile` does not make it atomic

`volatile` says "read and write the memory every time". It does not say "all at once". The innocent line `counter++` is three instructions:

```text
Increment_Plain:
   ldr   r2, [pc, #8]       @ address of the counter
   ldr   r3, [r2, #0]       @ 1. load the value
   adds  r3, #1             @ 2. add one
   str   r3, [r2, #0]       @ 3. store it back
```

If the interrupt arrives between the load and the store, and the interrupt also increments the counter, then one of the two increments is **lost**: the main code stores the old value plus one over the value that the interrupt has just stored. The timeline:

| Step | Main code | Interrupt | Counter |
|---|---|---|---|
| 1 | loads 5 | | 5 |
| 2 | | loads 5, adds 1, stores 6 | 6 |
| 3 | adds 1 (it has 5 in the register) | | 6 |
| 4 | stores 6 | | **6, should be 7** |

I wanted to show it on the Cortex-M4 too, and it did not work: in 200 000 increments with an interrupt every few instructions, QEMU lost nothing. That is probably because QEMU checks for the interrupts between the blocks of the translated code, so one never lands between the `ldr` and the `str`. It is a useful reminder that **a simulator does not prove the absence of a race condition**: the real MCU can interrupt after every instruction. The same race, in a place where it is easy to reproduce, is two threads on a PC:

```c title="host_race.c"
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>

#define INCREMENTS  ( 2000000u )

static volatile uint32_t plainCounter;
static _Atomic uint32_t  atomicCounter;

static void *Worker(void *argument)
{
    (void)argument;
    for (uint32_t index = 0u; index < INCREMENTS; index++)
    {
        plainCounter++;                       /* load, add, store: not atomic */
        atomic_fetch_add(&atomicCounter, 1u); /* one indivisible operation    */
    }
    return NULL;
}

int main(void)
{
    pthread_t first, second;

    pthread_create(&first, NULL, Worker, NULL);
    pthread_create(&second, NULL, Worker, NULL);
    pthread_join(first, NULL);
    pthread_join(second, NULL);

    printf("expected        %u\n", 2u * INCREMENTS);
    printf("plain counter   %u (lost %u)\n", plainCounter, 2u * INCREMENTS - plainCounter);
    printf("atomic counter  %u (lost %u)\n", atomicCounter, 2u * INCREMENTS - atomicCounter);
    return 0;
}
```

```text
expected        4000000
plain counter   2652421 (lost 1347579)
atomic counter  4000000 (lost 0)
```

A third of all increments is lost, and the results differ from run to run. The thread on a PC and the interrupt on an MCU are in this respect the same thing: a second flow of control that can strike between two instructions. The same applies to everything that is bigger than the word of the CPU: a 64-bit timestamp or a structure with two fields can be read half old and half new (*torn read*).

## Three ways to solve it

### 1. One writer for every variable (the best one)

The most robust solution is to design the data so that **every variable is written by one side only**. The interrupt writes the flag, the main code only reads it and does not clear it (or the other way around). Without two writers there is nothing to lose. If both sides need to change the same thing, they should not share it: each one has its own variable (the counter of the interrupts is `isrCalls`, the counter of the main code is a different one), and the sum is made by the reader.

### 2. A critical section

When two writers are unavoidable, the interrupts are disabled for the time of the operation. The correct way is to **save the state and restore it**, and not to enable the interrupts at the end blindly, because the function may have been called with the interrupts already disabled:

```text
Increment_CriticalSection:
   mrs   r1, PRIMASK        @ save the state of the mask
   cpsid i                  @ disable the interrupts
   ldr   r3, [r2, #0]
   adds  r3, #1
   str   r3, [r2, #0]
   msr   PRIMASK, r1        @ restore the state, as it was
```

The price is the latency: during the section no interrupt can run. So the section has to be as short as a few instructions, and without a function call, a loop or a wait inside.

### 3. An atomic operation

For a single word (a counter, a flag with a count) the processor has the instructions `LDREX` and `STREX`: the store succeeds only if nothing touched the address since the load, and when it does not, the loop repeats. The compiler generates them for you from the standard operation:

```text
Increment_Atomic:
   ldrex r1, [r3]           @ load and mark the address
   adds  r1, #1
   strex r2, r1, [r3]       @ store only if nobody has touched it, r2 = 0 on success
   cmp   r2, #0
   bne.n Increment_Atomic   @ somebody did: try again
```

in C it is one line, `__atomic_fetch_add(&counter, 1u, __ATOMIC_RELAXED)` (or `atomic_fetch_add()` from `<stdatomic.h>`). It does not disable the interrupts, so it does not add the latency. It works for a single variable; for two variables that belong together it does not help.

## The pattern that is used the most: a ring buffer

The most common thing that an interrupt gives to the main code is a stream of data: the bytes received by the UART, the samples of the ADC. The interrupt cannot process them (it has to be short), so it puts them in a **queue**, and the main code takes them out in a quiet moment. This is the producer-consumer problem with *one producer* (the interrupt) and *one consumer* (the main code), and for this exact case a ring buffer needs **no lock**:

```c title="Ring.h"
#ifndef RING_H
#define RING_H

#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>

#define RING_SIZE  ( 16u )                       /* has to be a power of two */
#define RING_MASK  ( RING_SIZE - 1u )

/*
 * Single producer, single consumer ring buffer without any lock.
 * head: written only by the producer, tail: written only by the consumer.
 * Both are free-running counters, the difference is the number of items.
 */
typedef struct
{
    uint32_t         items[RING_SIZE];
    atomic_uint_fast32_t head;
    atomic_uint_fast32_t tail;
}   ring_t;

static inline bool Ring_Push(ring_t *ring, uint32_t item)
{
    const uint_fast32_t head = atomic_load_explicit(&ring->head, memory_order_relaxed);
    const uint_fast32_t tail = atomic_load_explicit(&ring->tail, memory_order_acquire);

    if (RING_SIZE == (head - tail))
    {
        return false;                            /* full, the producer decides what to do */
    }

    ring->items[head & RING_MASK] = item;
    atomic_store_explicit(&ring->head, head + 1u, memory_order_release);   /* publish the item */
    return true;
}

static inline bool Ring_Pop(ring_t *ring, uint32_t *item)
{
    const uint_fast32_t tail = atomic_load_explicit(&ring->tail, memory_order_relaxed);
    const uint_fast32_t head = atomic_load_explicit(&ring->head, memory_order_acquire);

    if (head == tail)
    {
        return false;                            /* empty */
    }

    *item = ring->items[tail & RING_MASK];
    atomic_store_explicit(&ring->tail, tail + 1u, memory_order_release);   /* free the slot */
    return true;
}

#endif
```

Why is it correct?

- `head` is written **only by the producer** and `tail` **only by the consumer**. There is no variable with two writers, so no update can be lost: this is the first solution above, built into the structure.
- The counters are free-running (they are never reset). The number of items is `head - tail`, and thanks to the unsigned arithmetic it is correct even after the counters overflow. With the size a power of two, the position is a simple mask instead of a division.
- The **order** matters: the producer writes the item and **after that** publishes it by moving `head` (`memory_order_release`), and the consumer reads `head` first (`memory_order_acquire`) and only then the item. On a single Cortex-M core the order in which the compiler writes is the only thing that matters, and the atomics keep it. On an MCU with two cores (some of the STM32H7 have two) or with a cache, the same code is still correct, which is the reason to write it in this form and not with a `volatile` that happens to work.
- The producer does not wait. A full buffer means "drop the item and count it", because an interrupt cannot wait for anybody. The counter of the drops tells you in the test that the buffer is too small.

I tested it two ways. On a PC with two threads, a producer and a consumer, pass 20 million items through a buffer of 16 slots:

```text
items 20000000, order errors 0
```

and on the Cortex-M4 in QEMU: the SysTick interrupt is the producer and `main()` is the consumer, with 5000 items:

```text
items received  5000
order errors    0
full buffer hits 0
```

The first test is the harder one (the two threads really run in parallel on two cores), the second one is the real situation of an MCU. It is also a perfect candidate for the unit test on a PC, as in the article about [unit testing with Unity and CMock](/blog/unit-testing-unity-cmock): the module is independent of the hardware.

## Rules for the interrupt handlers

1. **Short.** Read the register, save the data, set the flag, clear the pending flag, return. The processing is done in the main code.
2. **No waiting, no allocation, no `printf`.** Nothing that blocks, takes a long time or calls a function that is not safe to call from an interrupt (it is *non-reentrant*, if it uses a static buffer inside).
3. **Everything shared is `volatile` or atomic**, and every variable has a defined writer.
4. **Do not share more than you must.** A flag or a queue between the sides, and not a structure of ten fields.
5. **Think about the priority.** An interrupt of a higher priority can interrupt another interrupt. A variable shared between two interrupts has the same problem as one shared with the main code.

In the Embedbits BSP, the peripheral modules (e.g. USART) have a polling, an interrupt and a DMA variant of the data handling, and the interrupt variant is exactly this: a handler on the MCAL level that takes the data from the peripheral and passes it to the application through a buffer, while the `Task` of the module runs in the main loop and does the processing.

## Summary

| The problem | The symptom | The cure |
|---|---|---|
| The compiler does not see the interrupt | Works with `-O0`, an endless loop with `-O2` | `volatile` on every shared variable |
| `counter++` is not atomic | A count that is sometimes too small | One writer per variable, a critical section or `atomic_fetch_add` |
| More than a word | Half old, half new value | A critical section, or a sequence number, or a queue |
| A stream of data | Lost or mixed bytes | A ring buffer with one producer and one consumer |
| The test passes in the simulator | A bug in the field | Remember that the simulator interrupts in different places than the MCU |

The three kinds of code in this article had one thing in common: they all *looked* right.
