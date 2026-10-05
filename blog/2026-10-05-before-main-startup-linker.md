---
title: "What happens before main(): reset, startup code and linker script"
slug: before-main-startup-linker
date: 2026-10-05T14:00:00
authors: [Mr.Nobody]
tags: [embedded, c, stm32]
---

Every C tutorial starts with `int main(void)`. Nobody explains who calls it. And yet, when you write `uint32_t counter = 5;` as a global variable and the first line of `main()` reads 5, a lot of work already happened. When the work is not done, the symptom is a variable with a random value that "worked yesterday".

In this article we follow the microcontroller from the reset to the first line of `main()`: what the hardware does by itself, what the linker script says and what the startup code has to do. It is the content of two modules of the Embedbits BSP ([Linker](/docs/bsp/linker) and [Startup](/docs/bsp/startup)), but the principle is the same on every Cortex-M. All code in the article was built with `arm-none-eabi-gcc` 13.2.1 and **run** in QEMU, on a model of an STM32F405 board, so the addresses and the outputs are real.

<!-- truncate -->

## What the C language expects

The C standard promises a few things about a program that the hardware does not know about:

- a global variable with an initializer (`uint32_t initializedValue = 0x12345678u;`) has this value at the start,
- a global or `static` variable without an initializer is **zero**,
- there is a stack and the function can use it,
- the global C++ objects are constructed (and in C, the functions marked with `__attribute__((constructor))` run) before `main()`.

The hardware gives you very little. After the reset a Cortex-M core does only two things: it reads **the initial value of the stack pointer** from the first word of the vector table and **the address of the reset handler** from the second one, and jumps there. Everything else is a job of the startup code, which is a part of **your** firmware.

## The vector table

The vector table is an array of addresses placed at the beginning of the flash (on an STM32 it is `0x08000000`, which is also visible at the address 0 after a boot from the flash). In the minimal form it has the stack pointer, the reset handler and the handlers of the exceptions:

```c
__attribute__((section(".isr_vector"), used))
void (* const vectorTable[])(void) =
{
    (void (*)(void))&_estack,   /* [0] initial stack pointer */
    Reset_Handler,              /* [1] where the core jumps after the reset */
    NMI_Handler,
    HardFault_Handler,
};
```

This is what the first 16 bytes of the built firmware contain:

```text
Contents of section .isr_vector:
 8000000 00000220 13000008 11000008 11000008
```

The numbers are in the little-endian order. The first word is `0x20020000`, the end of the 128 kB of RAM that starts at `0x20000000`, which is where the stack begins (it grows down). The second one is `0x08000013`: the reset handler is at `0x08000012` and the lowest bit says "Thumb code", which is mandatory on a Cortex-M. The rest are the exceptions; I pointed all unused ones to the same handler.

## The linker script: a map of the memory

The compiler produces the object files with the sections (`.text` for the code, `.data`, `.bss` and so on) and has no idea where in the memory they will be. That is decided by the linker, and it needs a map. This is the whole script of the example, 59 lines:

```text title="link.ld"
/* Entry point: the first instruction that runs after the reset */
ENTRY(Reset_Handler)

MEMORY
{
  FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 1024K
  RAM   (xrw) : ORIGIN = 0x20000000, LENGTH = 128K
}

/* The stack grows down from the end of the RAM */
_estack = ORIGIN(RAM) + LENGTH(RAM);

SECTIONS
{
  /* The vector table has to be at the very beginning of the flash */
  .isr_vector :
  {
    KEEP(*(.isr_vector))
  } > FLASH

  .text :
  {
    *(.text*)
    *(.rodata*)
    . = ALIGN(4);
  } > FLASH

  /* Constructors of the C++ objects and functions marked as constructor */
  .init_array :
  {
    . = ALIGN(4);
    __init_array_start = .;
    KEEP(*(.init_array*))
    __init_array_end = .;
  } > FLASH

  /* Start of the initial values of .data: in the flash, right after the code */
  _sidata = LOADADDR(.data);

  /* .data lives in the RAM (VMA), its initial values are stored in the flash (LMA) */
  .data :
  {
    . = ALIGN(4);
    _sdata = .;
    *(.data*)
    . = ALIGN(4);
    _edata = .;
  } > RAM AT > FLASH

  .bss (NOLOAD) :
  {
    . = ALIGN(4);
    _sbss = .;
    *(.bss*)
    *(COMMON)
    . = ALIGN(4);
    _ebss = .;
  } > RAM
}
```

Let us read the important parts.

**`MEMORY`** describes the physical memories: where they start and how big they are. The attributes tell the linker what is allowed there (`rx`: read and execute, `xrw`: everything).

**`.isr_vector` goes first** into the flash, and `KEEP` prevents the linker from throwing it away: nothing in the code *calls* the table, so without `KEEP` it would look unused. `.text` follows with the code and the read-only data (`.rodata`, which means `const` variables stay in the flash and do not use any RAM).

**`.data` is the interesting one.** Look at the line `} > RAM AT > FLASH`. Each section has two addresses:

- the **VMA** (virtual memory address), where the section is when the program *runs*: `.data` has to be in the RAM, because it is written,
- the **LMA** (load address), where the section is *stored* in the firmware image: the RAM is empty after a power-up, so the initial values must be somewhere that survives, the flash.

`arm-none-eabi-objdump -h` shows both:

```text
Idx Name          Size      VMA       LMA       File off  Algn
  0 .isr_vector   00000010  08000000  08000000  00001000  2**2
  1 .text         000001b0  08000010  08000010  00001010  2**2
  2 .init_array   00000004  080001c0  080001c0  000011c0  2**2
  3 .data         00000004  20000000  080001c4  00002000  2**2
  4 .bss          00000008  20000004  080001c8  00002004  2**2
```

`.data` lives at `0x20000000`, but its initial values are in the flash at `0x080001C4`. Somebody has to copy them, and that is why the script defines the symbols `_sidata` (the source in the flash), `_sdata` and `_edata` (the begin and the end of the target in the RAM). These symbols have no memory behind them, they are only addresses that the C code reads with `&_sdata`:

```text
080001c4 A _sidata
20000000 D _sdata
20000004 D _edata
20000004 B _sbss
2000000c B _ebss
20020000 R _estack
```

**`.bss` is `NOLOAD`.** It has no content in the image, only a size (a variable without an initializer and its zero value would waste the flash). The startup code has to fill the area between `_sbss` and `_ebss` with zeros.

**`.init_array`** is a table of the pointers to the constructors. The startup code goes through it and calls them.

The linker script of the Embedbits BSP is generated for each MCU by CMake from a template. It has the same symbols (`_sidata`, `_sdata`, `_edata`, `_sbss`, `_ebss`, `_stack_top`) and also describes optional regions, such as the CCMRAM of the STM32G4, where a section `.ccmram` can be placed.

## The startup code

The script said where everything is, and now the code does what the C language expects:

```c title="startup.c"
#include <stdint.h>

/* Symbols created by the linker script */
extern uint32_t _sidata, _sdata, _edata, _sbss, _ebss, _estack;
extern void (*__init_array_start[])(void);
extern void (*__init_array_end[])(void);

int main(void);
void Reset_Handler(void);
void Default_Handler(void);

/* A few of the exception handlers, all unused ones point to the default one */
void NMI_Handler(void)       __attribute__((weak, alias("Default_Handler")));
void HardFault_Handler(void) __attribute__((weak, alias("Default_Handler")));

/* The vector table: the first word is the initial stack pointer, the second the reset handler */
__attribute__((section(".isr_vector"), used))
void (* const vectorTable[])(void) =
{
    (void (*)(void))&_estack,
    Reset_Handler,
    NMI_Handler,
    HardFault_Handler,
};

void Reset_Handler(void)
{
#ifdef DEMO_DIRTY_RAM
    /* Only for the demo: RAM full of garbage, as after a reset of a running system.
     * The upper 4 kB are left alone, the stack of this function lives there. */
    for (uint32_t *ramWord = &_sdata; ramWord < (uint32_t *)((uintptr_t)&_estack - 0x1000u); ramWord++)
    {
        *ramWord = 0xA5A5A5A5u;
    }
#endif

#ifndef DEMO_SKIP_INIT
    /* 1. Copy the initial values of .data from the flash to the RAM */
    uint32_t *source = &_sidata;
    for (uint32_t *target = &_sdata; target < &_edata; )
    {
        *target++ = *source++;
    }

    /* 2. Zero the .bss */
    for (uint32_t *target = &_sbss; target < &_ebss; )
    {
        *target++ = 0u;
    }
#endif

    /* 3. Run the constructors */
    for (void (**constructor)(void) = __init_array_start; constructor < __init_array_end; constructor++)
    {
        (*constructor)();
    }

    /* 4. Hand over to the application */
    (void)main();

    for (;;) { }
}

void Default_Handler(void)
{
    for (;;) { }
}
```

The `Reset_Handler` has four steps (the `#ifdef` parts are for the experiment below):

1. **Copy `.data`** from the flash (`_sidata`) to the RAM (`_sdata` to `_edata`).
2. **Zero `.bss`** (`_sbss` to `_ebss`).
3. **Call the constructors** from `.init_array`.
4. **Call `main()`**. If it ever returns, the program stays in an infinite loop, because there is nobody to return to.

In the Embedbits BSP the startup module does a bit more according to its documentation: it also sets up the clocks (RCC through the MCAL) and then calls `AppMain()`. A rule that follows from the order: **anything that runs before the steps 1 and 2 must not touch a global variable**, because its content is not valid yet. The setup of the clocks is a function that uses only the registers, or the compiler keeps its state in locals.

## An experiment: what happens without it

The application of the example has four global variables of four kinds:

```c title="main.c"
uint32_t initializedValue = 0x12345678u;       /* .data: has a value in the flash */
uint32_t zeroedValue;                          /* .bss:  has to be zero            */
const uint32_t constantValue = 0xC0FFEE00u;    /* .rodata: stays in the flash      */
uint32_t constructedValue;                     /* set by a constructor before main */

__attribute__((constructor)) static void Construct(void)
{
    constructedValue = 0xC0DE0001u;
}

int main(void)
{
    PrintHex("initializedValue", initializedValue);
    PrintHex("zeroedValue      ", zeroedValue);
    PrintHex("constantValue    ", constantValue);
    PrintHex("constructedValue ", constructedValue);
    PrintHex("address of initializedValue", (uint32_t)&initializedValue);
    PrintHex("address of constantValue   ", (uint32_t)&constantValue);
    Quit();
    return 0;
}
```

(The part above this, with the functions that print through *semihosting*, is a few lines of code that ask QEMU to print a text and to quit. It is not important for the topic.)

First the normal build. The result:

```text
initializedValue 0x12345678
zeroedValue       0x00000000
constantValue     0xC0FFEE00
constructedValue  0xC0DE0001
address of initializedValue 0x20000000
address of constantValue    0x080001BC
```

All four values are as the C language promises, and the addresses confirm the story: the variable in the RAM is at `0x2000...`, the constant in the flash at `0x0800...`.

Now the experiment. After a reset of a running system, the RAM is not empty: it contains whatever was there before. The cold start of an MCU is often "lucky", because the RAM happens to be zero, and then a bug in the startup code is hidden for a long time. For the test I made the RAM dirty (`-DDEMO_DIRTY_RAM` fills it with `0xA5A5A5A5` before everything else) and then I removed the steps 1 and 2 (`-DDEMO_SKIP_INIT`):

```bash
arm-none-eabi-gcc -mcpu=cortex-m4 -mthumb -Os -ffreestanding -nostartfiles \
    -T link.ld -DDEMO_DIRTY_RAM -DDEMO_SKIP_INIT startup.c main.c -o broken.elf
qemu-system-arm -M netduinoplus2 -nographic \
    -semihosting-config enable=on,target=native -kernel broken.elf
```

```text
initializedValue 0xA5A5A5A5
zeroedValue       0xA5A5A5A5
constantValue     0xC0FFEE00
constructedValue  0xC0DE0001
```

Look at what is wrong and what is not:

- `initializedValue` and `zeroedValue` are garbage. The first one has no initial value, the second one is not zero, although both lines in the C file say otherwise.
- `constantValue` is fine, because it is in the flash and nobody needs to copy it.
- `constructedValue` is fine, because the constructor wrote it *after* the (missing) initialization. This is why this kind of the bug is so hard to find: one half of the program works, and the other half has random values.

With the dirty RAM and the complete startup code, the same program prints the correct values again.

## How it looks in real life

A few symptoms and what usually stands behind them:

| Symptom | Likely cause |
|---|---|
| The program hard-faults immediately after the reset | The first word of the vector table is not a valid stack address (wrong `_estack`, a wrong RAM size), or the table is not at the start of the flash |
| A global with an initializer has a wrong value, one with `= 0` also | `.data` is not copied or `.bss` is not zeroed (a wrong symbol, a section that is missing in the script) |
| It works after a power-up and fails after a reset | The same, the RAM was accidentally empty at the power-up |
| A strange value, which changes with the size of the code | The stack grows down to `.bss` / `.data`, the stack overflow |
| The first `printf` or a driver does not work | A code that runs before the steps 1 and 2 uses a global variable |

### What the numbers of the tool tell you

```text
   text	   data	    bss	    dec	    hex	filename
    448	      8	      8	    464	    1d0	good.elf
```

- **Flash** = `text` + `data`. The initial values of `.data` take space in the flash too, so a big initialized array costs you twice: in the flash and in the RAM. An array that does not change should be `const`, and then it is only in the flash.
- **RAM** = `data` + `bss` (+ the stack and the heap).

The linker can also check it for you, `-Wl,--print-memory-usage` prints how much of each region is used:

```text
Memory region         Used Size  Region Size  %age Used
           FLASH:         456 B         1 MB      0.04%
             RAM:          12 B       128 KB      0.01%
```

Put this flag into your build, and read the `.map` file (`-Wl,-Map,out.map`) when something is in an unexpected place: it contains the address of every function and every variable.

## Summary

1. After the reset the core reads two words: the stack pointer and the address of the reset handler. Everything else is your code.
2. The **linker script** is the map: where the memories are, in what order the sections lie and which symbols mark their boundaries.
3. The **startup code** is what makes the language promises true: it copies `.data`, zeroes `.bss`, runs the constructors and calls `main()`.
4. A variable that has a value in the flash and lives in the RAM has two addresses, the load address and the run address. This is the key to the whole topic.
5. Keep `-Wl,--print-memory-usage` on, and read `arm-none-eabi-size` and the map file. They tell you more than the debugger about where your memory went.

In the Embedbits BSP, you do not write these two files yourself: the linker script is generated for the selected MCU and the startup code comes with the BSP branch of the family. It is still worth understanding what they do, because when the firmware does not start, nobody else can help you.
