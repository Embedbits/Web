---
title: "One BSP, many STM32 families: why Git branches, and what they cost"
slug: bsp-stm32-families-git-branches
date: 2026-10-05T18:00:00
authors: [Mr.Nobody]
tags: [embedded, architecture, stm32]
---

STM32 is not one microcontroller, it is a dozen families: the G4, the H5, the U5, the F4 and so on. They have the same Cortex-M core, but different peripherals, different register names and a different vendor driver package. If you want one firmware architecture to run on all of them, you have to decide where the differences live. There is no free option, and this article describes the one that I chose for the Embedbits BSP, what the numbers from the real repositories say about it, and what it costs.

<!-- truncate -->

All the numbers below are from the repositories on 5 October 2026, measured with a small script that you will find at the end of the section about the costs. A word about the date: at that moment **STM32F4 is the only family with a complete release** of the BSP, and the release of the others (U5 first) was just being done. So the numbers show a platform in the middle of a migration, not the final state, and that is what makes them interesting. Run the script again after the release and compare.

## Four ways to support many families

| Approach | How it looks | Problem |
|---|---|---|
| **One tree, `#ifdef`** | `#if defined(STM32G4) ... #elif defined(STM32U5) ...` in the code | The code fills with the conditions, most of it is dead for any given build (see the rules about dead code in the article about [MISRA](/blog/misra-c-rules-in-practice)), and nobody dares to touch it |
| **Copy and paste** | A folder per family, a copy of everything | Every fix has to be done N times, by hand, and one of them is forgotten |
| **One repository per family** | `Bsp-G4`, `Bsp-U5`, ... | The same as the copy, only with more repositories |
| **Abstraction + a branch per family** | One interface, the family lives in a branch | A branch can drift away from the others (see below) |

I use the last one. The idea is that the user selects the family **once**, and from then on the tree contains only the code of that family.

## How it works in the BSP

Each STM32 family is a **Git branch** of the BSP repository (`STM32G4`, `STM32H5`, `STM32U5`, ...). The same is true for the modules of the BSP: the MCAL modules, the linker and the RAL. The platform does the rest. When you run the setup script of EmBi_Platform and choose *Configure BSP module*, it lists the branches:

```text
Available BSP Families:
[0]: STM32G4
[1]: STM32G4_Dev
[2]: STM32H5
[3]: STM32H5_Dev
[4]: STM32U5
[5]: master
Enter branch ID (numerical):
```

and after your choice it adds the BSP modules as Git submodules, checks out the branch and the commits of the family, and updates the CMake files. A project is pinned to the exact commits, so it builds the same tomorrow. The entries with `_Dev` are the development branches of the family and `master` contains the latest unreleased changes of all families, so it is meant for the work on the platform and not for a product. Switching to another family means running the same option again.

The vendor driver package follows the same scheme. The RAL has branches `STM32<family>` for the family, `STM32<family>_<major>.x` for a major release of the ST drivers and `STM32<family>_<major>.<minor>` for a minor one. When ST publishes a new version, there is a new branch and the old one stays available for the projects that use it.

## Where the differences really are

I wanted to know how much of the code is actually different between the families, so I compared the branches. Here is the GPIO module, `Bsp-Mcal-Gpio`, with the released STM32F4 as the reference. The numbers are the changed lines (added plus removed) in each file:

```text
file               STM32F4 vs STM32G4   STM32F4 vs STM32H5   STM32F4 vs STM32U5
Gpio.c             306                  142                  303
Gpio.h             5                    0                    0
Gpio_Port.h        3                    0                    0
Gpio_Types.h       35                   5                    28
```

The public interface, `Gpio_Port.h`, is **identical** on the F4 and the H5 and differs in three lines of a comment on the G4 and the U5. The G4 and the U5 are close to each other (their `Gpio.c` differs in three lines, again only a comment): they are the older generation of the module that is waiting for the release. Why is the *code of the module* so similar across two different families? Because the difference was moved out of the module, to the lowest layer. The RAL has a `Port` folder with one header for every peripheral, and the whole difference between the families in `Stm32_gpio.h` is this:

```diff
-#include "stm32g4xx_ll_gpio.h"              /* GPIO peripheral access layer   */
+#include "stm32u5xx_ll_gpio.h"              /* GPIO peripheral access layer   */
```

One line. The MCAL module includes `Stm32_gpio.h` and never knows which vendor driver is behind it. The same is true for the other peripherals I compared between the G4 and the U5 (`Stm32_rcc.h`, `Stm32_usart.h`, `Stm32_tim.h`): two differing lines in 32. That is the whole idea of a layered architecture, applied to the question of the families.

What does differ are the **sets of peripherals**. The `Port` folder of the G4 has headers for the HRTIM and the DMAMUX, which the U5 does not have, and the U5 has the caches, the PKA, the SDMMC and the low-power GPIO, which the G4 does not have. A module for a peripheral that a family does not have is simply not present in its branch, and that is where the *family support* table on the page about the [MCAL](/docs/bsp/mcal) comes from.

### Two levels: the family and the MCU

A branch handles the difference between the *families*. There is a smaller difference *inside* a family: the individual MCUs have a different number of the ports (an MCU in a small package has fewer GPIO ports than the one in a big package). That one is solved by a condition on the macros that the device header of the vendor already defines, not by a branch:

```c
static const gpio_PortConfig_t      gpio_PeriphConf[ GPIO_PORT_CNT ] =
{
#if defined(GPIOA)
    { .GpioReg = GPIOA, .GpioRcc = RCC_PERIPH_GPIOA },
#endif
/* ... */
#if defined(GPIOJ)
    { .GpioReg = GPIOJ, .GpioRcc = RCC_PERIPH_GPIOJ },
#endif
#if defined(GPIOK)
    { .GpioReg = GPIOK, .GpioRcc = RCC_PERIPH_GPIOK },
#endif
};
```

and, in the types, a port that does not exist is mapped to the value `GPIO_PORT_CNT`, so the other modules still compile and the use of such a port can be recognized as an invalid one. The rule: **a branch for a different family, `#if defined` of the vendor's macro for a different MCU in the same family.**

## What you get

- **The code of the family only.** There are no `#ifdef` forests, nothing is dead, and the diff of a change shows only the code that is built.
- **A clean separation of the vendor code.** The drivers of ST for each family are mirrored in their own branches of the RAL, and they are not modified. Your code does not contain them.
- **A stable interface for the application.** The application calls `Gpio_Set_PinLevel()`, and it does not know the family, so a change of the MCU is a different branch and not a rewrite of the application.
- **The pinned versions.** The project says exactly which commit of which branch it uses, so an update is a conscious decision.

## What it costs: the drift

The weakness of the branches is that they live their own lives. A fix that is done in one branch is not in the others, unless somebody takes it there. The measurement above shows two *generations* of the same module at the same time. The released F4 (and the H5, which follows it) has a refined initialization of the GPIO (the output level is set *before* the pin mode is switched to output, so the pin does not glitch), documented parameters and a `Tests` folder with the **unit tests and the integration tests**. The G4 and the U5 do not have any of that yet. The public interface of the USART in `Usart_Port.h` shows it even better:

| Branch | Public functions | Compared to the F4 |
|---|---|---|
| STM32F4 (released) | 79 | the reference |
| STM32H5 | 79 | the same set of functions, the header differs in 2 lines |
| STM32G4 | 82 | 12 functions that the F4 does not have (`Usart_StartTransmit`, `Usart_Set_TransmitBytes`, ...) and 9 that it has and the G4 does not (`Usart_Set_TxStart`, `Usart_Set_DataConfig`, ...) |
| STM32U5 | 83 | 13 functions only on the U5, 9 only on the F4 |

At this moment, a code that is written against the interface of the F4 compiles on the H5 and does not compile on the G4 and the U5. This is not a flaw of the approach, it is the normal state of a platform in the middle of a release. But it shows the price: the promise "the same BSP interface for all families" is true for a family only **after its branch has been released**, and the time between the release of the first family and of the last one is the period in which the branches drift away from each other. During it nobody should write an application for the family that is not ready.

### How to keep the drift under control

1. **Have a reference branch and a list of what is ported.** One family leads (here the F4), the others follow, and the status is visible: that is the table of the family support on the MCAL page, extended with "the same version of the interface as the reference".
2. **Make the release one operation.** A release script that goes through all the modules of one family (the way the U5 release is being done) is better than a hand-made merge: the family is either ready as a whole, or it is not.
3. **Measure the drift.** The script below compares one module on several branches and prints the number of the changed lines per file. Zero or a comment means "the same", a big number is the work that is waiting. It takes a second and fits into a CI job.
4. **Let one test suite check all branches.** The unit tests that exist on the F4 (and the H5) are the specification of the module. If the same `Test_Gpio.c` has to pass on every family branch, the interface cannot silently diverge. The article about the [unit testing](/blog/unit-testing-unity-cmock) shows how such a test is built.
5. **Keep the difference at the bottom.** Everything that can be moved to the `Port` headers of the RAL (a single `#include`, as shown above) is a difference that does not need to be maintained per branch. The more code is *identical*, the easier it is to take a fix from one branch to another (`git cherry-pick`).

```sh title="branch-drift.sh"
#!/usr/bin/env bash
# Shows how much a module differs between its family branches.
# Usage: branch-drift.sh <repository-url> <branch> <branch> [<branch>...]
set -euo pipefail

repo="$1"; shift
branches=("$@")

work="$(mktemp -d)"
git init -q "$work"
git -C "$work" remote add origin "$repo"
for branch in "${branches[@]}"; do
    git -C "$work" fetch -q --depth 1 origin "refs/heads/$branch:refs/remotes/origin/$branch"
done

files="$(git -C "$work" ls-tree -r --name-only "origin/${branches[0]}" | grep -E '\.(c|h)$' || true)"

printf '%-44s' "file"
for ((i = 1; i < ${#branches[@]}; i++)); do printf '%-24s' "${branches[0]} vs ${branches[i]}"; done
printf '\n'

for file in $files; do
    printf '%-44s' "$file"
    for ((i = 1; i < ${#branches[@]}; i++)); do
        changed="$(git -C "$work" diff --numstat "origin/${branches[0]}" "origin/${branches[i]}" -- "$file" | awk '{print $1 + $2}')"
        printf '%-24s' "${changed:-0}"
    done
    printf '\n'
done
rm -rf "$work"
```

Used on the branches of the GPIO module (the table above is its output):

```bash
./branch-drift.sh https://github.com/Embedbits/Bsp-Mcal-Gpio STM32F4 STM32G4 STM32H5 STM32U5
```

For the other modules the picture is different, and that is useful to know before you plan the work:

```text
file             F4 vs G4   F4 vs H5   F4 vs U5
Exti_Port.h      0          0          0
Exti.c           586        538        682
Usart_Port.h     55         2          28
Usart.c          3734       2301       3927
```

The EXTI has an unchanged public header on all the branches and a different implementation (the peripherals differ, the interface does not). The USART differs in the interface of the G4 and the U5 and in a big part of the implementation, which is a measure of how much work the release of those two is.

## Which approach to choose

- **Branches per family** fit when the families differ in the *set* of peripherals and in the vendor drivers, when the product is built for several families and when you can afford to maintain the interface (the drift is manageable with a few families and a tool).
- **`#ifdef` in one tree** is acceptable when the differences are small: one family with a few MCU variants, a single register that is named differently.
- **Neither of them** helps without the **abstraction at the bottom**. The branch only decides which implementation of the interface is in the tree. If the application includes the vendor headers, a branch per family does not save you from anything.

And whatever you choose, write down which family is the reference one and keep one number in a CI job: how far the others are.
