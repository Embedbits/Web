---
title: "Debugging a HardFault on a Cortex-M: from a mystery to a line of code"
slug: debugging-hardfault-cortex-m
date: 2026-10-07T20:00:00
authors: [Mr.Nobody]
tags: [embedded, c, stm32]
---

Every embedded developer knows the moment: the firmware has been running, and then it does not. The debugger shows that the program sits in an infinite loop with a name like `HardFault_Handler` or `Default_Handler`, and the call stack is a few meaningless frames. That loop is the **default** handler of the startup code, and it says exactly nothing about what happened. The fault has a cause, and the processor has already written it down: in eight registers on the stack and in four status registers. It is only necessary to read them.

This article shows how to turn the loop into a line of source code, in two real examples that I ran in QEMU (a model of an STM32F4 board) and examined with GDB: a call of a `NULL` function pointer and a write to an address where nothing is. All outputs are real.

<!-- truncate -->

## What the core does when a fault happens

On a Cortex-M the processor does not crash silently. When it cannot continue (an invalid instruction, a bus error, an access that is not allowed), it takes an **exception** and does two things that are important for the debugging:

1. It **pushes eight registers on the stack**: `R0`, `R1`, `R2`, `R3`, `R12`, `LR`, `PC` and `xPSR`. The saved `PC` is the instruction that caused the fault, and the saved `LR` tells who called the faulting function.
2. It sets **bits in the fault status registers** that say what kind of a fault it was: `CFSR` (the configurable fault status, which is made of three parts for the memory, the bus and the usage faults), `HFSR` (the hard fault status) and the address registers `MMFAR` and `BFAR` with the address that was accessed.

The memory, bus and usage faults have their own handlers, but they are **disabled** after the reset, so every fault is *escalated* to the HardFault. That is the reason why the one handler sees everything, and the bit `FORCED` in `HFSR` says that this has happened.

## A handler that reads the registers

The only difficulty is to get to the stack where the registers are. There are two stack pointers on the core (`MSP` for the exceptions and the main code, `PSP` for the tasks of an operating system), and the bit 2 of the value in `LR` at the entry of the exception tells which of them was used. This has to be done *before* the compiler uses the stack for its own purposes, so the handler is a short function in assembler (`naked`: no prologue), which passes the pointer to a function in C:

```c title="fault.c (the report)"
/* ---- the fault report ---- */
#define SCB_CFSR  (*(volatile uint32_t *)0xE000ED28u)   /* configurable fault status */
#define SCB_HFSR  (*(volatile uint32_t *)0xE000ED2Cu)   /* hard fault status */
#define SCB_MMFAR (*(volatile uint32_t *)0xE000ED34u)
#define SCB_BFAR  (*(volatile uint32_t *)0xE000ED38u)

/* The registers that the core pushed on the stack when the fault happened. */
typedef struct
{
    uint32_t r0, r1, r2, r3, r12;
    uint32_t lr;     /* where the faulting code was called from */
    uint32_t pc;     /* the instruction that caused the fault   */
    uint32_t xpsr;
}   stackFrame_t;

volatile struct
{
    stackFrame_t frame;
    uint32_t     cfsr, hfsr, mmfar, bfar;
}   faultInfo;

void HardFault_Report(const stackFrame_t *frame) __attribute__((used));
void HardFault_Report(const stackFrame_t *frame)
{
    faultInfo.frame = *frame;
    faultInfo.cfsr  = SCB_CFSR;
    faultInfo.hfsr  = SCB_HFSR;
    faultInfo.mmfar = SCB_MMFAR;
    faultInfo.bfar  = SCB_BFAR;

    Print("*** HardFault ***\n");
    PrintHex("PC   ", frame->pc);
    PrintHex("LR   ", frame->lr);
    PrintHex("xPSR ", frame->xpsr);
    PrintHex("CFSR ", faultInfo.cfsr);
    PrintHex("HFSR ", faultInfo.hfsr);

    for (;;) { }          /* stay here, so that a debugger can look at the state */
}

/* The core uses the main or the process stack, depending on bit 2 of EXC_RETURN (in LR). */
__attribute__((naked)) void HardFault_Handler(void)
{
    __asm__ volatile (
        "tst   lr, #4        \n"
        "ite   eq            \n"
        "mrseq r0, msp       \n"
        "mrsne r0, psp       \n"
        "b     HardFault_Report \n"
    );
}
```

Look at the three parts. The structure `stackFrame_t` is the layout of the eight registers in the order that the core pushes them. The function `HardFault_Report()` copies them (together with the status registers) into the global variable `faultInfo`, prints a short report, and then **stays in a loop on purpose**, so a debugger can connect and look at the variable. The assembler stub selects the right stack and jumps to it. In a product, the report would be written to a memory that survives the reset, and the firmware would reset itself, but the principle is the same.

## Example 1: the call of a `NULL` pointer

This is the application with the bug. A callback is registered later, but the code that calls it runs earlier:

```c title="fault.c (the application)"
/* ---- the application with a bug ---- */
typedef void (*callback_t)(void);

static callback_t onButtonPressed;      /* will be registered later: it is NULL at the start */

void Button_Pressed(void)
{
    onButtonPressed();                  /* the bug: the callback is called before it is set */
}

int main(void)
{
    Print("start\n");
    Button_Pressed();
    Print("never printed\n");
    return 0;
}
```

The program prints `start`, and then the report:

```text
start
*** HardFault ***
PC    0x00000000
LR    0x08000115
xPSR  0x60000000
CFSR  0x00020000
HFSR  0x40000000
```

Now the reading of it, value by value:

- **`PC = 0x00000000`**: the processor tried to execute an instruction at the address zero. Almost always, this means a jump through a `NULL` function pointer, or a return to a corrupted address.
- **`CFSR = 0x00020000`**: the bit 17 is `INVSTATE`, "invalid state". The processor attempted to execute in the ARM state, which a Cortex-M does not have. The reason is in the **`xPSR`**: its bit 24 is the `T` bit (Thumb), and here it is zero (`0x60000000`). The address of a Thumb function has the lowest bit set, and `NULL` has not, so the jump through the pointer cleared the `T` bit. That the `T` bit is zero is the typical fingerprint of a jump to `NULL`.
- **`HFSR = 0x40000000`**: the bit 30 is `FORCED`, the fault was escalated to the HardFault from the usage fault, which is not enabled.
- **`LR = 0x08000115`**: the return address, with the lowest bit set (Thumb). It is the address of the **caller**, `0x08000114`, and that is where the bug is.

With the debugger, the last step takes seconds. The QEMU waits for GDB (`-S -gdb tcp::1234`), and the session:

```text
(gdb) break fault.c:64
(gdb) continue
Breakpoint 1, HardFault_Report (frame=0x2001ffc0) at fault.c:64
(gdb) print/x faultInfo.frame
$1 = {r0 = 0xdeadbeef, r1 = 0x80001f4, r2 = 0x8000220, r3 = 0x0, r12 = 0x0,
      lr = 0x8000115, pc = 0x0, xpsr = 0x60000000}
(gdb) print/x faultInfo.cfsr
$2 = 0x20000
(gdb) info symbol faultInfo.frame.lr
Button_Pressed + 7 in section .text
(gdb) list *(faultInfo.frame.lr & ~1u)
0x8000114 is in Button_Pressed (fault.c:87).
82	static callback_t onButtonPressed;      /* will be registered later: it is NULL at the start */
84	void Button_Pressed(void)
85	{
86	    onButtonPressed();                  /* the bug: the callback is called before it is set */
87	}
(gdb) x/2i (faultInfo.frame.lr & ~1u) - 4
   0x8000110 <Button_Pressed+2>:	movs	r3, #0
   0x8000112 <Button_Pressed+4>:	blx	r3
```

`info symbol` gives the function, `list *` gives the line (the one *after* the call, because that is the return address), and the disassembly shows the instruction pair that is the bug itself: the load of the zero into `r3` and the `blx r3`, a call through a register that holds `NULL`. Note `r3 = 0x0` in the stacked registers. Without the debugger, the same answer is in one command of the toolchain, which only needs the address from the report and the file with the debug information (`-g`):

```text
$ arm-none-eabi-addr2line -e fault.elf -f 0x08000114
Button_Pressed
fault.c:87
```

## Example 2: a write to an address where nothing is

I changed one line of the application: instead of the callback, the function writes to the address `0xA0000000`, where nothing is mapped in the model of the chip. The report:

```text
*** HardFault ***
PC    0x08000124
LR    0x08000199
xPSR  0x21000000
CFSR  0x00008200
HFSR  0x40000000
```

This time the `PC` is a **valid address in the flash**, the `T` bit is set (`0x21000000`) and `CFSR` is different: `0x8200` are two bits, 9 (`PRECISERR`, a precise data bus error) and 15 (`BFARVALID`, the register `BFAR` holds the address). In GDB:

```text
(gdb) print/x faultInfo.cfsr
$1 = 0x8200
(gdb) print/x faultInfo.bfar
$2 = 0xa0000000
(gdb) info symbol faultInfo.frame.pc
main + 12 in section .text
```

`BFAR` is the address that the program tried to write, `PC` is the instruction that tried it. Together they say "this instruction wrote to this address", which is the complete description of the problem. If the address is small (`0x00000008`), it is a `NULL` pointer to a structure and you are accessing a member. If it looks like data (`0x20000000` and a bit more), it is a stack or a buffer that you have overrun.

## The bits of the CFSR that you will meet

The register is a combination of three registers (each of them has its own byte or two bytes). These are the ones that you will see most often (the two that I observed in the examples are marked):

| Bit | Name | Meaning |
|---|---|---|
| 0 | `IACCVIOL` | the instruction fetch from a region that is not allowed (MPU) |
| 1 | `DACCVIOL` | the data access to a region that is not allowed (MPU) |
| 7 | `MMARVALID` | the register `MMFAR` holds the address |
| 8 | `IBUSERR` | the bus error on an instruction fetch |
| **9** | **`PRECISERR`** | **the precise bus error on a data access: `PC` is the instruction that did it** |
| 10 | `IMPRECISERR` | the imprecise bus error: the instruction has already gone, `PC` is not reliable |
| 11, 12 | `UNSTKERR`, `STKERR` | the bus error while the registers were popped or pushed (often a damaged stack) |
| **15** | **`BFARVALID`** | **the register `BFAR` holds the address** |
| 16 | `UNDEFINSTR` | an undefined instruction (executing data, a corrupted code) |
| **17** | **`INVSTATE`** | **an attempt to execute in the ARM state: a jump to an address with the bit 0 clear** |
| 18 | `INVPC` | an invalid `EXC_RETURN` (a damaged stack of an exception) |
| 19 | `NOCP` | an access to a coprocessor that is not enabled (typically the FPU that was not switched on) |
| 24 | `UNALIGNED` | an unaligned access, when the trap is enabled |
| 25 | `DIVBYZERO` | a division by zero, when the trap is enabled |

## What usually stands behind a HardFault

| What you see | What it usually is |
|---|---|
| `PC = 0`, `INVSTATE` | a call through a `NULL` function pointer, or a return to a corrupted address |
| `PRECISERR` and a small `BFAR` | a `NULL` pointer to a structure |
| `PRECISERR` and `BFAR` in a peripheral address range | an access to a peripheral that is not available, for example one whose clock has not been switched on (on some families such an access is a bus error, on others it is silently ignored) |
| `STKERR` / `UNSTKERR`, or a `PC` that makes no sense | a stack overflow or a buffer overflow that damaged the return address |
| `NOCP` at the first floating point instruction | the FPU has not been enabled in the startup code |
| `IMPRECISERR` | a write that went through a write buffer: the report arrives later than the instruction. For the debugging, the buffering can be switched off (the bit `DISABLEDEFWRITEBUF` in `ACTLR`), so the fault becomes precise |

I demonstrated the first line of the table and the principle of the second (a bus error with the address in `BFAR`). The remaining lines are a summary of the usual causes, they follow from the meaning of the bits in the reference manual of the core.

## Practice

1. **Never leave the default handler as an empty loop.** The handler above is about thirty lines, and it turns the fault into a report with a place in the code. Put it into the startup code of the project once.
2. **Keep the debug information** in the file that you archive with the release (`-g`, and the `.elf`), so the address of a report from the field can be turned into a line, even if the firmware is delivered stripped. That is also one more reason for the [reproducible build](/blog/reproducible-builds-embedded): the address means something only for the exact binary that produced it.
3. **Enable the finer faults** (the bits in `SHCSR`) when you want the `UsageFault`, `BusFault` and `MemManage` handlers separately. The report is richer, because the status registers are not shared.
4. **Store the report in a memory that survives a reset** (a section that the startup code does not clear, see the article about [what happens before `main()`](/blog/before-main-startup-linker)), reset, and send it after the restart. The report of a device in the field is worth more than a hundred guesses.
5. **Prevent what you can.** The `NULL` call in the example is a defect that the [rules of MISRA](/blog/misra-c-rules-in-practice) and a unit test of the module (the pointer must be set before the first call) would catch, and a stack overflow is the thing for which the stack usage has to be known (the rule against the recursion).

## The same session on a board

I used QEMU, because it does not need a board, and its GDB server (`-S -gdb tcp::1234`) behaves the same as the one of a debug probe: the commands in the examples are the commands that you type with a probe. The platform has an artifact for the **probe-rs** toolset (a debugging toolset for ARM targets over a debug probe, with a DAP server), which is the way to connect GDB or an IDE to a real board. I did not run it for this article, as I do not have a probe in my environment.

## Summary

1. A HardFault is not a mystery: the core has pushed the registers and set the status bits.
2. The handler needs to find the right stack (`EXC_RETURN`) and to read the frame, `CFSR`, `HFSR` and `BFAR`.
3. `PC` and `LR` give the place, `CFSR` gives the kind, `BFAR` gives the address.
4. `PC = 0` with `INVSTATE` is a jump to `NULL`, and the `T` bit of the `xPSR` shows it.
5. Keep the `.elf`, and the address of a field report becomes a line of code.
