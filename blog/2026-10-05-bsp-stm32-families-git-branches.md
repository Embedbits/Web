---
title: "One BSP, many STM32 families: why Git branches, and what they cost"
slug: bsp-stm32-families-git-branches
date: 2026-10-05T18:00:00
authors: [Mr.Nobody]
tags: [embedded, architecture, stm32]
---

STM32 is not one microcontroller, it is a dozen families: the G4, the H5, the U5, the F4 and so on. They have the same Cortex-M core, but different peripherals, different register names and a different vendor driver package. If you want one firmware architecture to run on all of them, you have to decide where the differences live. There is no free option, and this article describes the one that I chose for the Embedbits BSP, what the numbers from the real repositories say about it, and what it costs.

<!-- truncate -->

All the numbers below are from the state of the repositories on 5 October 2026, measured with a small script that you will find at the end of the section about the costs.

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

I wanted to know how much of the code is actually different between the families, so I compared the branches. Here is the GPIO module, `Bsp-Mcal-Gpio`, on the branches of the three families. The numbers are the changed lines (added plus removed) in each file:

```text
file          STM32G4 vs STM32H5    STM32G4 vs STM32U5
Gpio.c        176                   3
Gpio.h        5                     5
Gpio_Port.h   3                     3
Gpio_Types.h  30                    47
```

The public interface, `Gpio_Port.h`, differs in three lines, and all three are the text of a comment. `Gpio.c` of G4 and U5 differs in three lines, again only a comment. The *implementation of the module is the same*, although these are two different families. How is that possible? The difference was moved out of the module, to the lowest layer. The RAL has a `Port` folder with one header for every peripheral, and the whole difference between the families in `Stm32_gpio.h` is this:

```diff
-#include "stm32g4xx_ll_gpio.h"              /* GPIO peripheral access layer   */
+#include "stm32u5xx_ll_gpio.h"              /* GPIO peripheral access layer   */
```

One line. The MCAL module includes `Stm32_gpio.h` and never knows which vendor driver is behind it. The same is true for the other peripherals I compared (`Stm32_rcc.h`, `Stm32_usart.h`, `Stm32_tim.h`): two differing lines in 32. That is the whole idea of a layered architecture, applied to the question of the families.

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

The weakness of the branches is that they live their own lives. A fix that is done in one branch is not in the others, unless somebody takes it there. Look at the same module again. `Gpio.c` of the H5 differs from the one of the G4 in 176 lines, and the cause is not the hardware. The H5 branch has a refined initialization (the output level is set *before* the pin mode is switched to output, so the pin does not glitch), documented parameters and a **folder with the unit tests and the integration tests**, which the G4 and the U5 do not have. It looks like simply the newer version of the module. Another module shows how far this can go. The public interface of the USART in `Usart_Port.h`:

| Branch | Public functions | Only here |
|---|---|---|
| STM32G4 | 82 | 12 (`Usart_StartTransmit`, `Usart_StopTransmit`, `Usart_Set_TransmitBytes`, the `Usart_Set_...IsrCallback` functions, ...) |
| STM32H5 | 79 | 9 (`Usart_Set_TxStart`, `Usart_Set_RxStart`, `Usart_Set_DataConfig`, `Usart_Get_TxState`, ...) |
| STM32U5 | 83 | compared to the H5: the DMA functions (`Usart_Set_DmaTxStart`, `Usart_Init_Dma`, ...) and the ISR callbacks, but not the `Usart_Set_TxStart` family |

The three families have three different USART interfaces at this moment, so a code written against one of them does not compile on the others. This is not a bug in the approach, it is a normal state of a platform that is being developed: the new design was done on one family first. But it shows the price. The promise "the same BSP interface for all families" is true for the GPIO and the EXTI (their ports differ in comments only), and not yet for the USART.

### How to keep the drift under control

1. **Have a reference branch and a list of what is ported.** One family leads, the others follow, and the status is visible: that is the table of the family support on the MCAL page, extended with "the same version of the interface".
2. **Measure the drift.** The script below compares one module on several branches and prints the number of the changed lines per file. Zero or a comment means "the same", a big number is the work that is waiting. It takes a second and fits into a CI job.
3. **Let one test suite check all branches.** The unit tests that now exist only on the H5 branch are the specification of the module. If the same `Test_Gpio.c` has to pass on every family branch, the interface cannot silently diverge. The article about the [unit testing](/blog/unit-testing-unity-cmock) shows how such a test is built.
4. **Keep the difference at the bottom.** Everything that can be moved to the `Port` headers of the RAL (a single `#include`, as shown above) is a difference that does not need to be maintained per branch. The more code is *identical*, the easier it is to take a fix from one branch to another (`git cherry-pick`).

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

printf '%-22s' "file"
for ((i = 1; i < ${#branches[@]}; i++)); do printf '%-24s' "${branches[0]} vs ${branches[i]}"; done
printf '\n'

for file in $files; do
    printf '%-22s' "$file"
    for ((i = 1; i < ${#branches[@]}; i++)); do
        changed="$(git -C "$work" diff --numstat "origin/${branches[0]}" "origin/${branches[i]}" -- "$file" | awk '{print $1 + $2}')"
        printf '%-24s' "${changed:-0}"
    done
    printf '\n'
done
rm -rf "$work"
```

Used on the three branches of the GPIO module:

```bash
./branch-drift.sh https://github.com/Embedbits/Bsp-Mcal-Gpio STM32G4 STM32H5 STM32U5
```

For the other modules the picture is different, and that is useful to know before you plan the work:

```text
Exti.c           494   266      Exti_Port.h     0   0      Exti_Types.h    24   13
Usart.c         4053  2073      Usart_Port.h   53  41      Usart_Types.h 1020  484
```

The EXTI has an unchanged public header and a different implementation (the peripherals differ, the interface does not), the USART differs everywhere.

## Which approach to choose

- **Branches per family** fit when the families differ in the *set* of peripherals and in the vendor drivers, when the product is built for several families and when you can afford to maintain the interface (the drift is manageable with a few families and a tool).
- **`#ifdef` in one tree** is acceptable when the differences are small: one family with a few MCU variants, a single register that is named differently.
- **Neither of them** helps without the **abstraction at the bottom**. The branch only decides which implementation of the interface is in the tree. If the application includes the vendor headers, a branch per family does not save you from anything.

And whatever you choose, write down which family is the reference one and keep one number in a CI job: how far the others are.
