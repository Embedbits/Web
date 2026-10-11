---
title: "Jeden BSP, mnoho rodin STM32: proč Git větve a kolik stojí"
slug: bsp-stm32-families-git-branches
date: 2026-10-05T18:00:00
authors: [Mr.Nobody]
tags: [embedded, architecture, stm32]
---

STM32 není jeden mikrokontrolér, je to tucet rodin: G4, H5, U5, F4 a tak dále. Mají stejné jádro Cortex-M, ale jiné periferie, jiné názvy registrů a jiný balík ovladačů od výrobce. Pokud chcete, aby jedna architektura firmwaru běžela na všech, musíte se rozhodnout, kde budou rozdíly žít. Žádná varianta není zadarmo. Tento článek popisuje tu, kterou jsem zvolil pro BSP Embedbits, co o ní říkají čísla ze skutečných repozitářů a kolik stojí.

<!-- truncate -->

Všechna čísla níže pocházejí z repozitářů ze dne 5. října 2026, změřená malým skriptem, který najdete na konci části o nákladech. Poznámka k datu: v tu chvíli je **STM32F4 jedinou rodinou s kompletním vydáním** BSP a vydání ostatních (jako první U5) se právě připravovalo. Čísla tedy ukazují platformu uprostřed migrace, ne konečný stav, a právě to je činí zajímavými. Spusťte skript znovu po vydání a porovnejte.

## Čtyři způsoby, jak podporovat mnoho rodin

| Přístup | Jak vypadá | Problém |
|---|---|---|
| **Jeden strom, `#ifdef`** | `#if defined(STM32G4) ... #elif defined(STM32U5) ...` v kódu | Kód se zaplní podmínkami, jejich většina je pro konkrétní build mrtvá (viz pravidla o mrtvém kódu v článku o [MISRA](/blog/misra-c-rules-in-practice)) a nikdo se jich neodváží dotknout |
| **Copy-paste** | Složka pro každou rodinu, kopie všeho | Každou opravu je nutné udělat N-krát ručně a jedna z nich se zapomene |
| **Jeden repozitář na rodinu** | `Bsp-G4`, `Bsp-U5`, ... | Totéž co kopie, jen s více repozitáři |
| **Abstrakce + větev pro každou rodinu** | Jedno rozhraní, rodina žije ve větvi | Větev se může od ostatních vzdálit (viz níže) |

Používám tu poslední. Myšlenka je, že uživatel vybere rodinu **jednou** a od té chvíle strom obsahuje už jen kód této rodiny.

## Jak to funguje v BSP

Každá rodina STM32 je **Git větev** repozitáře BSP (`STM32G4`, `STM32H5`, `STM32U5`, ...). Totéž platí pro moduly BSP: moduly MCAL, linker a RAL. Zbytek obstará platforma. Když spustíte instalační skript EmBi_Platform a vyberete *Configure BSP module*, vypíše větve:

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

a po vašem výběru přidá moduly BSP jako Git submoduly, přepne na větev a commity dané rodiny a aktualizuje soubory CMake. Projekt je připnutý na konkrétní commity, takže se zítra sestaví stejně. Položky s `_Dev` jsou vývojové větve rodiny a `master` obsahuje nejnovější nevydané změny všech rodin, je tedy určen pro práci na platformě, ne pro produkt. Přepnutí na jinou rodinu znamená spustit stejnou volbu znovu.

Balík ovladačů výrobce se řídí stejným schématem. RAL má větve `STM32<family>` pro rodinu, `STM32<family>_<major>.x` pro hlavní vydání ovladačů ST a `STM32<family>_<major>.<minor>` pro vedlejší. Když ST zveřejní novou verzi, vznikne nová větev a stará zůstane dostupná pro projekty, které ji používají.

## Kde jsou rozdíly doopravdy

Chtěl jsem vědět, kolik kódu se mezi rodinami skutečně liší, a tak jsem porovnal větve. Tady je modul GPIO, `Bsp-Mcal-Gpio`, s vydanou STM32F4 jako referencí. Čísla jsou změněné řádky (přidané plus odebrané) v každém souboru:

```text
soubor             STM32F4 vs STM32G4   STM32F4 vs STM32H5   STM32F4 vs STM32U5
Gpio.c             306                  142                  303
Gpio.h             5                    0                    0
Gpio_Port.h        3                    0                    0
Gpio_Types.h       35                   5                    28
```

Veřejné rozhraní, `Gpio_Port.h`, je na F4 a H5 **totožné** a na G4 a U5 se liší ve třech řádcích komentáře. G4 a U5 jsou si navzájem blízké (jejich `Gpio.c` se liší ve třech řádcích, opět jen komentář): jde o starší generaci modulu, která čeká na vydání. Proč je *kód modulu* tak podobný u dvou různých rodin? Protože rozdíl byl vyňat z modulu do nejnižší vrstvy. RAL má složku `Port` s jednou hlavičkou pro každou periferii a celý rozdíl mezi rodinami v `Stm32_gpio.h` je tento:

```diff
-#include "stm32g4xx_ll_gpio.h"              /* GPIO peripheral access layer   */
+#include "stm32u5xx_ll_gpio.h"              /* GPIO peripheral access layer   */
```

Jeden řádek. Modul MCAL vkládá `Stm32_gpio.h` a nikdy neví, jaký ovladač výrobce je za ním. Totéž platí pro další periferie, které jsem porovnal mezi G4 a U5 (`Stm32_rcc.h`, `Stm32_usart.h`, `Stm32_tim.h`): dva odlišné řádky z 32. To je celá myšlenka vrstvené architektury, aplikovaná na otázku rodin.

Co se liší, jsou **sady periferií**. Složka `Port` pro G4 obsahuje hlavičky pro HRTIM a DMAMUX, které U5 nemá, a U5 má cache, PKA, SDMMC a low-power GPIO, které G4 nemá. Modul pro periferii, kterou rodina nemá, ve své větvi prostě není, a odtud pochází tabulka *podpora rodin* na stránce o [MCAL](/docs/bsp/mcal).

### Dvě úrovně: rodina a MCU

Větev řeší rozdíl mezi *rodinami*. Menší rozdíl existuje *uvnitř* rodiny: jednotlivé MCU mají různý počet portů (MCU v malém pouzdře má méně portů GPIO než to ve velkém). To se řeší podmínkou na makrech, která hlavičkový soubor zařízení od výrobce už definuje, ne větví:

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

a v typech je neexistující port namapován na hodnotu `GPIO_PORT_CNT`, takže ostatní moduly se stále překládají a použití takového portu lze rozpoznat jako neplatné. Pravidlo: **větev pro jinou rodinu, `#if defined` na makro výrobce pro jiné MCU ve stejné rodině.**

## Co získáte

- **Pouze kód dané rodiny.** Žádné lesy `#ifdef`, nic není mrtvé a diff změny ukazuje jen kód, který se skutečně sestavuje.
- **Čisté oddělení kódu výrobce.** Ovladače ST pro každou rodinu jsou zrcadleny ve vlastních větvích RAL a nejsou upravovány. Váš kód je neobsahuje.
- **Stabilní rozhraní pro aplikaci.** Aplikace volá `Gpio_Set_PinLevel()` a rodinu nezná, takže změna MCU je jiná větev, ne přepsání aplikace.
- **Připnuté verze.** Projekt přesně říká, který commit které větve používá, takže aktualizace je vědomé rozhodnutí.

## Kolik to stojí: drift

Slabinou větví je, že žijí vlastním životem. Oprava provedená v jedné větvi není v ostatních, dokud ji tam někdo nepřenese. Výše uvedené měření ukazuje současně dvě *generace* téhož modulu. Vydané F4 (a H5, které po něm následuje) má vylepšenou inicializaci GPIO (výstupní úroveň se nastaví *před* přepnutím pinu do režimu výstupu, takže pin nezakmitá), zdokumentované parametry a složku `Tests` s **unit testy a integračními testy**. G4 a U5 nic z toho zatím nemají. Veřejné rozhraní USART v `Usart_Port.h` to ukazuje ještě lépe:

| Větev | Veřejné funkce | Ve srovnání s F4 |
|---|---|---|
| STM32F4 (vydaná) | 79 | reference |
| STM32H5 | 79 | stejná sada funkcí, hlavička se liší ve 2 řádcích |
| STM32G4 | 82 | 12 funkcí, které F4 nemá (`Usart_StartTransmit`, `Usart_Set_TransmitBytes`, ...) a 9, které F4 má a G4 ne (`Usart_Set_TxStart`, `Usart_Set_DataConfig`, ...) |
| STM32U5 | 83 | 13 funkcí jen na U5, 9 jen na F4 |

V tuto chvíli se kód napsaný proti rozhraní F4 přeloží na H5 a nepřeloží na G4 a U5. To není chyba přístupu, je to běžný stav platformy uprostřed vydání. Ukazuje to ale cenu: slib „stejné rozhraní BSP pro všechny rodiny“ platí pro rodinu až **po vydání její větve** a doba mezi vydáním první a poslední rodiny je období, kdy se větve od sebe vzdalují. Během něj by nikdo neměl psát aplikaci pro rodinu, která není připravená.

### Jak držet drift pod kontrolou

1. **Mějte referenční větev a seznam toho, co je portováno.** Jedna rodina vede (zde F4), ostatní následují a stav je viditelný: to je tabulka podpory rodin na stránce MCAL, rozšířená o „stejná verze rozhraní jako reference“.
2. **Udělejte z vydání jednu operaci.** Release skript, který projde všechny moduly jedné rodiny (tak, jak se dělá vydání U5), je lepší než ručně provedený merge: rodina je buď připravená celá, nebo není.
3. **Měřte drift.** Skript níže porovná jeden modul na několika větvích a vypíše počet změněných řádků na soubor. Nula nebo komentář znamená „stejné“, velké číslo je práce, která čeká. Trvá to vteřinu a vejde se to do CI jobu.
4. **Nechte jednu sadu testů kontrolovat všechny větve.** Unit testy, které existují na F4 (a H5), jsou specifikací modulu. Pokud musí stejný `Test_Gpio.c` projít na každé větvi rodiny, rozhraní se nemůže nepozorovaně rozejít. Článek o [unit testování](/blog/unit-testing-unity-cmock) ukazuje, jak takový test postavit.
5. **Držte rozdíl dole.** Vše, co lze přesunout do hlaviček `Port` v RAL (jediný `#include`, jak je ukázáno výše), je rozdíl, který není třeba udržovat po větvích. Čím více kódu je *totožného*, tím snazší je převzít opravu z jedné větve do druhé (`git cherry-pick`).

```sh title="branch-drift.sh"
#!/usr/bin/env bash
# Ukáže, jak moc se modul liší mezi větvemi rodin.
# Použití: branch-drift.sh <repository-url> <branch> <branch> [<branch>...]
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
