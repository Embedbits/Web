---
title: "MISRA C rules in practice: what they are, why they exist and how to live with them"
slug: misra-c-rules-in-practice
date: 2026-10-04T10:00:00
authors: [Mr.Nobody]
tags: [embedded, c, misra]
---

Say "MISRA" in a room full of embedded developers and half of them will sigh, and the other half will ask which tool you use. The reputation of the rules is mixed: for some they are the bureaucracy that eats a week before every release, for others the reason why a car does not reboot on the highway. Both groups are partly right.

In this article I will go through the rules that I meet most often, one by one: what the rule asks for, what you get for it, what the bad code looks like, what the good code looks like and who finds the problem for you. All examples are real C code that I compiled and ran.

<!-- truncate -->

> **A word about the rule texts**
>
> MISRA C is a copyrighted document of the MISRA consortium. I do not copy its wording here. Every rule is described in my own words, with my own examples, and only the numbers and the categories are quoted. The numbers refer to **MISRA C:2012** (MISRA C:2023 consolidates the amendments, keeps these numbers and adds a few new guidelines). Before you build anything on this article, check the rule in your own copy of the standard, which you can get at [misra.org.uk](https://misra.org.uk). This article is independent and not endorsed by MISRA.

## What MISRA C is (and what it is not)

MISRA stands for *Motor Industry Software Reliability Association*. The first guidelines for C were published in 1998 for the automotive industry, today they are used in aerospace, rail, medical devices and industrial automation, basically everywhere where a software failure hurts somebody.

The central idea is simple. C is a language that allows a lot of things that are legal but dangerous: undefined behaviour, implementation defined behaviour, implicit conversions that change values, pointers that can point anywhere. MISRA defines a **subset of C** in which the dangerous parts are forbidden or have to be justified. It is not a different language, and a MISRA compliant program is still a normal C program that your normal compiler builds.

What MISRA is **not**:

- It is not a certification. "MISRA compliant" is a claim that you make and document, nobody stamps your code.
- It is not a guarantee of correctness. The rules remove classes of bugs, they do not check that the thermostat controls the temperature.
- It is not about style. Naming, indentation and file organization are not part of MISRA, that is what a [coding style](/docs/platform/embi-platform/coding-style) is for.

### How to read a rule

Each guideline has three properties which you should know before you read the first one:

| Property | Values | Meaning |
|---|---|---|
| **Kind** | *Directive* / *Rule* | A rule can be checked by looking at the source code alone. A directive needs more information (a design, a process), so a tool can help but cannot decide. |
| **Category** | *Mandatory* / *Required* / *Advisory* | Mandatory: no deviation. Required: a deviation is possible with a written justification. Advisory: recommendation, you only have to record that you do not follow it. |
| **Decidability** | *Decidable* / *Undecidable* | Whether a tool can give an exact answer. For undecidable rules even the best analyzer produces false positives or misses something. |

The numbering is `Dir 4.12` for directives and `Rule 9.1` for rules, where the first number is the topic (9 = initialization, 10 = types, 11 = pointers, ...).

## The rules, one by one

I grouped them by the problem they solve, not by the number.

### Rules about values that are not what you think

#### Rule 9.1 - read before write (Mandatory)

**The rule:** do not read a variable with automatic storage before a value was assigned to it.

**What you get:** the value of such a variable is garbage, and on a different compiler or optimization level it is *different* garbage. Bugs like "works in debug, fails in release" very often end here. Because the rule is mandatory, no deviation is possible.

Bad, the variable is set only on one path:

```c
uint8_t Gain_Bad(bool isHigh)
{
    uint8_t gain;
    if (isHigh) { gain = 8u; }
    return gain;                       /* indeterminate value when isHigh is false */
}
```

Good, every path has a defined value:

```c
uint8_t Gain_Good(bool isHigh)
{
    uint8_t gain = 1u;
    if (isHigh) { gain = 8u; }
    return gain;
}
```

**Who finds it:** the compiler sometimes (`-Wall -Wmaybe-uninitialized` with optimization), a static analyzer reliably. In my test build, gcc stayed silent on this function. Do not rely on it.

#### Rules 10.1, 10.3, 10.4 - essential types (Required)

**The rules:** the MISRA authors invented the *essential type model*: the type that an expression *looks like* it has (an `uint8_t` stays "unsigned 8 bit" in their view), in contrast to the type that C silently uses (`int`, because of the integer promotion). The rules forbid operations between inappropriate types, assigning a value to a narrower type and mixing categories (signed, unsigned, boolean, character, floating).

**What you get:** the integer promotions are the largest source of surprises in embedded C. All values smaller than `int` are promoted to `int` before any arithmetic, and you do not see it. Two classic results:

```c
bool Flags_Bad(uint8_t flags)
{
    return (~flags == 0xF0u);          /* ~flags is an int: 0xFFFFFFF0 - never equal */
}
```

`~flags` is not an 8 bit value, it is an `int` with the value `0xFFFFFFF0`. The comparison never succeeds, whatever the argument is. The fix is to say what you mean:

```c
bool Flags_Good(uint8_t flags)
{
    return ((uint8_t)~flags == 0xF0u);
}
```

The second classic is the silent narrowing:

```c
uint8_t Add_Bad(uint8_t first, uint8_t second)
{
    uint8_t sum = first + second;      /* int result silently narrowed */
    return sum;
}
```

`200 + 100` is calculated as `int` (300), and the assignment to `uint8_t` keeps only 44. No warning, no error, a wrong sum. Two correct variants: widen the result, or cast deliberately and think about the overflow.

```c
uint16_t Add_Good(uint8_t first, uint8_t second)
{
    uint16_t sum = (uint16_t)first + (uint16_t)second;
    return sum;
}
```

**Who finds it:** a good static analyzer. The compiler helps only partly: `-Wsign-compare` (part of `-Wextra`) reported the first example, while gcc stayed silent on the second one.

#### Directive 4.6 - types with size and signedness (Advisory)

**The directive:** use typedefs that tell the size and the signedness (`uint8_t`, `int32_t`, or your own names) instead of `char`, `short`, `int` and `long`.

**What you get:** the width of `int` depends on the compiler and the MCU: 16 bit on small 8 and 16 bit controllers, 32 bit on a Cortex-M. A code that works on one target silently changes on another. With fixed width types it is visible in the source what the code does. In my projects I go one step further and make own type names for physical values (`temperature_t`, `humidity_t`), so the compiler stops me when I mix them.

```c
int counter;       /* 16 or 32 bits? the answer depends on the target */
uint16_t counter;  /* 16 bits everywhere */
```

#### Rule 1.3 - no undefined behaviour (Required)

**The rule:** the program must not contain undefined behaviour. This includes the signed overflow, shifts by too many bits, a division by zero, use of a dangling pointer and many more.

**What you get:** with undefined behaviour the compiler may do *anything*, including the removal of your safety check, because "this case cannot happen". The most known example is the signed overflow: `first + second` on `int32_t` that does not fit is not "wrap around", it is a license for the optimizer.

```c
int32_t Add_Bad2(int32_t first, int32_t second)
{
    return first + second;             /* signed overflow is undefined behaviour */
}
```

The correct code checks the condition *before* the operation and reports the problem to the caller:

```c
bool Add_Safe(int32_t first, int32_t second, int32_t *result)
{
    bool isOk = true;

    if (((second > 0) && (first > (INT32_MAX - second))) ||
        ((second < 0) && (first < (INT32_MIN - second))))
    {
        isOk = false;
    }
    else
    {
        *result = first + second;
    }
    return isOk;
}
```

The same applies to shifts. The mask of a bit position is only defined if the position is smaller than the width of the type:

```c
uint32_t Bit_Mask(uint8_t position)
{
    return (position < 32u) ? (1u << position) : 0u;
}
```

**Who finds it:** partly the compiler (`-fsanitize=undefined` finds it at run time during tests), partly the analyzer. The rule is undecidable in general: a tool can show you all the places which could be a problem.

### Rules about conditions and control flow

#### Rule 14.4 - controlling expression is a boolean (Required)

**The rule:** the condition of `if`, `while` and `for` has to be an expression that has the essential Boolean type, i.e. the result of a comparison or a `bool`. An integer or a pointer alone is not allowed.

**What you get:** the intention is readable. `while (count)` does not tell whether you want "while it is not zero" or "while it is not the end". The explicit form looks the same for numbers, pointers and flags. (I write the constant on the left side, `0u != count`, so a typo with a single `=` does not compile.)

```c
uint8_t Count_Bad(uint8_t count)
{
    uint8_t steps = 0u;
    while (count) { count--; steps++; }
    return steps;
}
```
```c
uint8_t Count_Good(uint8_t count)
{
    uint8_t steps = 0u;
    while (0u != count) { count--; steps++; }
    return steps;
}
```

**Who finds it:** every MISRA analyzer, it is a decidable rule.

#### Rule 12.1 - make the operator precedence explicit (Advisory)

**The rule:** do not rely on the reader (and yourself) to remember the precedence table, use parentheses.

**What you get:** the precedence of `&` and `==` in C is the opposite of what the human brain expects. This is the bug that everyone writes at least once:

```c
bool Masked_Bad(uint8_t flags)
{
    return (flags & MASK == MASK);     /* == binds stronger than & */
}
```

`MASK == MASK` is evaluated first and gives `1`, so the function tests the bit 0 and not the mask. It returns `true` for `0x01` and `false` for `0x0C`, exactly wrong. With the parentheses the bug cannot exist:

```c
bool Masked_Good(uint8_t flags)
{
    return ((flags & MASK) == MASK);
}
```

**Who finds it:** the compiler (`-Wparentheses` is part of `-Wall`) and every analyzer.

#### Rules 15.6, 15.7, 16.3 and 16.4 - complete statements (Required)

**The rules:**

- 15.6: the body of `if`, `else`, `for`, `while` is always a block in braces,
- 15.7: every `if ... else if` chain ends with an `else`,
- 16.3: every `switch` clause ends with `break` (or another unconditional jump),
- 16.4: every `switch` has a `default`.

**What you get:** the rules force you to answer the question "what happens in all the other cases?" at the moment when you write the code and not in the field. A `switch` without a `break` is a classic bug, an `enum` that gets a new value without a `default` is the second one. The braces remove the family of bugs where a second statement is added under an `if` and looks like it is conditional:

```c
if (isError)
    Led_On();
    Buzzer_On();      /* indented like it belongs to the if - it does not */
```

And here is the switch. The first version falls from `MODE_ON` into `MODE_ERROR` and sets the wrong value, the second one handles every case explicitly:

```c
void Mode_Bad(mode_t_ mode)
{
    switch (mode)
    {
        case MODE_ON:
            gLeds = 1u;
        case MODE_ERROR:               /* falls through by accident */
            gLeds = 3u;
            break;
    }
}
```
```c
void Mode_Good(mode_t_ mode)
{
    switch (mode)
    {
        case MODE_ON:
            gLeds = 1u;
            break;
        case MODE_ERROR:
            gLeds = 3u;
            break;
        case MODE_OFF:
        default:
            gLeds = 0u;
            break;
    }
}
```

In my test gcc found the missing `default` and the fall-through (`-Wswitch-default -Wimplicit-fallthrough`). The `else` rule and the braces are checked by an analyzer or by the formatter.

#### Rule 17.2 - no recursion (Required)

**The rule:** a function must not call itself, neither directly nor through other functions.

**What you get:** on a PC the stack has megabytes. On a microcontroller you have a few kilobytes, and the worst case of the recursion depth depends on the input data. If you remove recursion, the maximal stack usage can be *calculated* (the static analysis of the call tree is enough), and a stack overflow stops being a surprise.

```c
uint32_t Factorial_Recursive(uint32_t value)
{
    return (value <= 1u) ? 1u : value * Factorial_Recursive(value - 1u);
}
```

The iterative version needs a constant amount of the stack:

```c
uint32_t Factorial_Iterative(uint32_t value)
{
    uint32_t result = 1u;
    for (uint32_t factor = 2u; factor <= value; factor++) { result *= factor; }
    return result;
}
```

**Who finds it:** the analyzer and the linker map (some toolchains print the call graph, `-fstack-usage` tells the size of each frame).

### Rules about memory and pointers

#### Directive 4.12 and Rule 21.3 - no dynamic memory (Required)

**The rule:** do not use `malloc`, `calloc`, `realloc` and `free`.

**What you get:**

- the heap *fragments*. After weeks of running a request for 64 bytes can fail although 10 kB are free, only not in one piece,
- the execution time of `malloc` is not deterministic,
- a memory leak after weeks of running is the worst kind of the bug to find,
- the memory consumption is known at link time, not at 3 a.m. in the field.

A standard alternative is a pool with a fixed size, which has the same API shape as the allocator:

```c
#define FRAME_POOL_SIZE 4u

typedef struct
{
    uint8_t data[8];
    bool    inUse;
}   frame_t;

static frame_t framePool[FRAME_POOL_SIZE];
```

```c
frame_t *Frame_Acquire(void)
{
    for (uint8_t index = 0u; index < FRAME_POOL_SIZE; index++)
    {
        if (!framePool[index].inUse) { framePool[index].inUse = true; return &framePool[index]; }
    }
    return NULL;                       /* the caller has to handle "no frame" - at test time, not at 3 a.m. */
}
```

The function returns `NULL` if all frames are taken, so the case "no memory" is handled in the code and is testable on a PC. Exactly the same happens with `malloc`, only you cannot test it, because on your PC the allocation never fails.

**Who finds it:** the analyzer, or simply a linker which does not link `malloc` at all.

#### Rules 11.3 and 11.5 - careful with pointer casts (Required / Advisory)

**The rules:** do not cast a pointer to an object of one type to a pointer to an object of another type (11.3), and avoid the conversion from `void *` to an object pointer (11.5).

**What you get:** the cast of a byte buffer to `uint32_t *` is the most common way to read a field of a communication frame:

```c
uint32_t ReadU32_Bad(const uint8_t *buffer)
{
    return *(const uint32_t *)buffer;  /* misaligned access, strict aliasing violation */
}
```

It is undefined behaviour twice. The address does not need to be aligned to four bytes (a hard fault on a Cortex-M0, a slow access somewhere else), and the access through a pointer of another type violates the aliasing rules, so the optimizer may reorder or drop it. Two correct solutions: `memcpy` (the compiler turns it into a single load where the hardware allows it) or an assembly of the bytes, which also fixes the byte order and does not depend on the endianness of the CPU:

```c
uint32_t ReadU32_Good(const uint8_t *buffer)
{
    uint32_t value;
    (void)memcpy(&value, buffer, sizeof value);
    return value;
}
```
```c
uint32_t ReadU32LittleEndian(const uint8_t *buffer)
{
    return (uint32_t)buffer[0] | ((uint32_t)buffer[1] << 8) | ((uint32_t)buffer[2] << 16) | ((uint32_t)buffer[3] << 24);
}
```

The cast of `void *` is typical for a generic callback context. It is advisory because in C it is sometimes the only way. The benefit of the rule is that you will notice every such place and do the cast at a single line in the beginning of the function (as in the [article about SOLID](/blog/solid-principles-c-cpp)), and not everywhere.

**Who finds it:** every analyzer. A compiler finds the cast only on some targets and with `-Wcast-align`.

#### Rule 8.13 - a pointer to const when possible (Advisory)

**The rule:** if a function does not change the data behind a pointer, the pointer is declared as a pointer to `const`.

**What you get:** the signature is a contract. The caller sees from the prototype that the function only reads, and the compiler guards it. A `const` buffer from the flash can be passed only to a function with `const`, otherwise the code does not compile (or worse, it writes to the flash and causes a fault).

```c
uint8_t Checksum_Bad(uint8_t *data, size_t length)
{
    uint8_t sum = 0u;
    for (size_t index = 0u; index < length; index++) { sum = (uint8_t)(sum + data[index]); }
    return sum;
}
```
```c
uint8_t Checksum_Good(const uint8_t *data, size_t length)
{
    uint8_t sum = 0u;
    for (size_t index = 0u; index < length; index++) { sum = (uint8_t)(sum + data[index]); }
    return sum;
}
```

### Rules about the code you wrote and the code that is not there

#### Rule 17.7 and Directive 4.7 - do not ignore results (Required)

**The rules:** a returned value must be used (17.7), and when a function returns an error code, it has to be tested (4.7).

**What you get:** an ignored return value is an ignored error. The sending of a frame to a busy UART, a refused write to the flash, a timeout of the I2C: all of them silently pass, and the application continues with a wrong assumption. If you really do not care, say it with `(void)`, so the reader (and the analyzer) knows that it was a decision and not a mistake:

```c
bool Send_Checked(const uint8_t *data, size_t length)
{
    if (UART_OK != Uart_Send(data, length)) { return false; }
    return true;
}
```

```c
(void)Uart_Send(message, sizeof message);   /* a log message, loss is acceptable */
```

**Who finds it:** the analyzer, in gcc with `__attribute__((warn_unused_result))` on your own API.

#### Rules 2.1 and 2.2 - no unreachable and no dead code (Required)

**The rules:** the project must not contain code that can never be executed (2.1), and code which is executed but has no influence on the result (2.2).

**What you get:** both kinds are a signal of a mistake: a condition which never occurs, a forgotten `return`, or a copy-paste error. Dead code also falsifies the test coverage (you cannot reach 100 % of the lines which no input executes) and it makes the reader to think about it. Both appear in this function:

```c
uint8_t Level_Get(uint8_t raw)
{
    uint8_t level = 3u;                /* dead: overwritten before it is read */
    level = (uint8_t)(raw / 2u);
    return level;
    Level_Log(raw);                    /* unreachable */
}
```

The first assignment of `level` is dead and the last line is unreachable.

**Who finds it:** the analyzer. gcc with `-Wall -Wextra` was silent in my test.

#### Rule 20.7 and Directive 4.9 - macros with parameters (Required / Advisory)

**The rule:** an expanded macro parameter has to be in parentheses (20.7), and a function is preferred to a function-like macro (4.9).

**What you get:** a macro is a text replacement. If you do not protect the parameter, the precedence of the *caller* decides:

```c
#define SQUARE_BAD(x)  x * x
#define SQUARE_OK(x)   ((x) * (x))

SQUARE_BAD(2 + 1)   /* 2 + 1 * 2 + 1 = 5, not 9 */
SQUARE_OK(2 + 1)    /* ((2 + 1) * (2 + 1)) = 9 */
```

Even the protected macro has a problem: `SQUARE_OK(count++)` increments twice. That is why directive 4.9 recommends a function. An inline function has a type, evaluates the argument once and costs the same:

```c
static inline uint32_t Square(uint32_t value) { return value * value; }
```

## Using MISRA in a real project

### Compiler warnings are the first step, not the last

I compiled all the examples above with `gcc -Wall -Wextra -Wconversion -Wshadow -Wswitch-default -Wimplicit-fallthrough -O2`. gcc reported five warnings, and they belong to only three of the "bad" examples: the comparison with the promoted complement, the `switch` (missing `default`, unhandled enum value and the fall-through) and the missing parentheses around `==` in a mask test. It stayed silent about the narrowing, the uninitialized variable, the dead and the unreachable code, the signed overflow, the recursion, the pointer cast and the macro.

My recommendation is a compiler with the maximum of warnings and `-Werror` in the CI as the baseline. It is free and it removes the most obvious problems, but it is not a replacement of the static analysis.

### Choose a tool and put it in the CI

To check the rules you need a static analyzer. There are commercial ones (Polyspace, Helix QAC, PC-lint Plus, Coverity, Parasoft C/C++test, LDRA, IAR C-STAT and others) and free ones which cover a part of the rules, for example [cppcheck](https://cppcheck.sourceforge.io/) with its MISRA addon. The addon needs the text of the rules as an input, and because of the copyright you have to provide it from your own copy of the standard. A tool is never perfect: for undecidable rules you will have false positives, and sometimes a violation is missed.

The check belongs into the CI of every commit, not into a manual run before the release. Otherwise you do the same work three times: once when you write, once when the violations are found and once when you fix them.

### Deviations are part of the system

Sometimes a rule must be broken. A hardware register access needs a cast of an integer to a pointer, a bootloader needs to write to the flash through a pointer. MISRA knows it and defines a **deviation**: a record with the rule, the place, the reason and the risk assessment. The record should be next to the code:

```c
/* MISRA deviation: Rule 11.4 (Advisory), see DEV-012
 * Reason: the address of the peripheral register is fixed by the hardware.
 * Contained in this macro, the rest of the code uses the register type. */
#define UART_REGS ((uartRegisters_t *)0x40004400u)
```

A deviation is not a failure. A list of well argued deviations is the sign of a project in which people think. A project with zero deviations and without hardware access is usually either lying or very small.

### Legacy code and vendor code

You will not make the 200 000 lines of an old project compliant in a week. What works:

1. **Do not touch the old code,** enable the check for *new and changed* files. The analyzer's baseline stores the existing violations, and the CI fails only on new ones.
2. **Start with the mandatory and required rules,** advisory ones later.
3. **Exclude third-party code** and document it. The generated code of the vendor (HAL, LL, CMSIS) is not yours to fix. This is one more reason for the layered architecture from the article about [design and architecture](/blog/design-architecture): when the vendor code sits in the RAL, and the MCAL and everything above it is your code, the borderline of the check is a folder.

### What does not help

- **Chasing the number of violations.** A rule fixed in a way that satisfies the tool and breaks the sense (a cast added only to silence the warning) is worse than the original.
- **Using MISRA as an argument.** "MISRA says so" is not a reason. If you cannot explain what the rule protects you from, you will not be able to decide when it is time for a deviation.
- **Believing that compliance means correct.** MISRA makes some mistakes impossible. The requirements, the architecture, the review and the tests stay yours.

## Summary

| Rule | In short | Benefit |
|---|---|---|
| 9.1 | Initialize before reading | No random values, same behavior in debug and release |
| 10.x | Respect the essential types | No surprises from integer promotion and narrowing |
| Dir 4.6 | Fixed width types | The same code means the same on every target |
| 1.3 | No undefined behavior | The optimizer cannot remove your checks |
| 14.4 | Explicit conditions | The intention is readable |
| 12.1 | Parentheses | No precedence bugs |
| 15.6, 15.7, 16.3, 16.4 | Braces, `else`, `break`, `default` | Every case is handled |
| 17.2 | No recursion | Stack usage can be calculated |
| Dir 4.12, 21.3 | No dynamic memory | No fragmentation, leaks and surprises in timing |
| 11.3, 11.5 | No pointer type tricks | No alignment and aliasing bugs |
| 8.13 | `const` pointers | The signature is a contract |
| 17.7, Dir 4.7 | Use the return values | Errors do not disappear |
| 2.1, 2.2 | No unreachable or dead code | Mistakes are visible, coverage is meaningful |
| 20.7, Dir 4.9 | Safe macros, prefer functions | No hidden double evaluation or precedence bugs |

If you remember one thing: **a MISRA rule is the scar of a bug that somebody already had.** You do not need to like the rules, but it is good to know what each of them is a scar of. Then you will know when to follow it, and when to write a deviation and take the responsibility.

The rules described here are only a selection. The full set has more than 140 guidelines, and the rest (the preprocessor, the standard library, the structure of the declarations) is worth reading in your copy of the standard, once.
