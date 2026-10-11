---
title: "Jeden BSP, mnoho rodín STM32: prečo Git vetvy a čo stoja"
slug: bsp-stm32-families-git-branches
date: 2026-10-05T18:00:00
authors: [Mr.Nobody]
tags: [embedded, architecture, stm32]
---

STM32 nie je jeden mikrokontrolér, je to tucet rodín: G4, H5, U5, F4 a ďalšie. Majú rovnaké jadro Cortex-M, ale odlišnú periférnu výbavu, odlišné názvy registrov a iný balík ovládačov od výrobcu. Ak chcete, aby jedna architektúra firmvéru bežala na všetkých, musíte rozhodnúť, kde budú rozdiely žiť. Zadarmo sa to nedá a tento článok opisuje variant, ktorý som zvolil pre Embedbits BSP, čo o ňom hovoria čísla zo skutočných repozitárov a koľko stojí.

<!-- truncate -->

Všetky čísla nižšie pochádzajú z repozitárov k 5. októbru 2026 a boli zmerané malým skriptom, ktorý nájdete na konci časti o nákladoch. Poznámka k dátumu: v tom momente je **STM32F4 jedinou rodinou s kompletným vydaním** BSP a vydanie ostatných (ako prvé U5) sa práve robilo. Čísla teda ukazujú platformu uprostred migrácie, nie konečný stav, a práve to ich robí zaujímavými. Spustite skript znova po vydaní a porovnajte.

## Štyri spôsoby, ako podporiť viac rodín

| Prístup | Ako vyzerá | Problém |
|---|---|---|
| **Jeden strom, `#ifdef`** | `#if defined(STM32G4) ... #elif defined(STM32U5) ...` v kóde | Kód sa zaplní podmienkami, väčšina z neho je pre konkrétny build mŕtva (pozrite si pravidlá o mŕtvom kóde v článku o [MISRA](/blog/misra-c-rules-in-practice)) a nikto sa ho neodváži zmeniť |
| **Copy and paste** | Priečinok pre každú rodinu, kópia všetkého | Každá oprava sa musí urobiť N-krát ručne a jedna sa zabudne |
| **Jeden repozitár na rodinu** | `Bsp-G4`, `Bsp-U5`, ... | To isté ako kópia, len s viacerými repozitármi |
| **Abstrakcia + vetva na rodinu** | Jedno rozhranie, rodina žije vo vetve | Vetva sa môže od ostatných vzďaľovať (pozri nižšie) |

Používam posledný variant. Myšlienka je, že používateľ vyberie rodinu **raz** a odvtedy strom obsahuje iba kód tej rodiny.

## Ako to funguje v BSP

Každá rodina STM32 je **vetva Gitu** repozitára BSP (`STM32G4`, `STM32H5`, `STM32U5`, ...). To isté platí pre moduly BSP: moduly MCAL, linker a RAL. Zvyšok urobí platforma. Keď spustíte inštalačný skript EmBi_Platform a vyberiete *Configure BSP module*, zobrazí zoznam vetiev:

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

a po vašom výbere pridá moduly BSP ako submoduly Gitu, prepne vetvu a commity danej rodiny a aktualizuje súbory CMake. Projekt je pripnutý na presné commity, takže zajtra sa zostaví rovnako. Položky s `_Dev` sú vývojové vetvy rodiny a `master` obsahuje najnovšie nevydané zmeny všetkých rodín, takže je určený na prácu na platforme, nie na produkt. Prepnutie na inú rodinu znamená spustiť tú istú voľbu znova.

Balík ovládačov od výrobcu sleduje rovnakú schému. RAL má vetvy `STM32<family>` pre rodinu, `STM32<family>_<major>.x` pre hlavné vydanie ovládačov ST a `STM32<family>_<major>.<minor>` pre vedľajšie. Keď ST zverejní novú verziu, vznikne nová vetva a stará zostane dostupná pre projekty, ktoré ju používajú.

## Kde sú skutočné rozdiely

Chcel som vedieť, koľko kódu sa medzi rodinami skutočne líši, a tak som porovnal vetvy. Tu je modul GPIO, `Bsp-Mcal-Gpio`, s vydaným STM32F4 ako referenciou. Čísla sú zmenené riadky (pridané plus odstránené) v každom súbore:

```text
file               STM32F4 vs STM32G4   STM32F4 vs STM32H5   STM32F4 vs STM32U5
Gpio.c             306                  142                  303
Gpio.h             5                    0                    0
Gpio_Port.h        3                    0                    0
Gpio_Types.h       35                   5                    28
```

Verejné rozhranie, `Gpio_Port.h`, je na F4 a H5 **identické** a na G4 a U5 sa líši v troch riadkoch komentára. G4 a U5 sú si blízke (ich `Gpio.c` sa líši v troch riadkoch, opäť len komentár): sú to staršia generácia modulu, ktorá čaká na vydanie. Prečo je *kód modulu* taký podobný naprieč dvoma rôznymi rodinami? Pretože rozdiel bol vytlačený z modulu do najnižšej vrstvy. RAL má priečinok `Port` s jednou hlavičkou pre každú periférnu jednotku a celý rozdiel medzi rodinami v `Stm32_gpio.h` je toto:

```diff
-#include "stm32g4xx_ll_gpio.h"              /* GPIO peripheral access layer   */
+#include "stm32u5xx_ll_gpio.h"              /* GPIO peripheral access layer   */
```

Jeden riadok. Modul MCAL includuje `Stm32_gpio.h` a nikdy nevie, ktorý ovládač výrobcu je za ním. To isté platí pre ostatné periférie, ktoré som porovnal medzi G4 a U5 (`Stm32_rcc.h`, `Stm32_usart.h`, `Stm32_tim.h`): dva odlišné riadky z 32. To je celá myšlienka vrstvenej architektúry, aplikovaná na otázku rodín.

Čo sa naozaj líši, sú **sady periférií**. Priečinok `Port` pre G4 má hlavičky pre HRTIM a DMAMUX, ktoré U5 nemá, a U5 má cache, PKA, SDMMC a low-power GPIO, ktoré G4 nemá. Modul pre periféria, ktoré rodina nemá, sa v jej vetve jednoducho nenachádza, a odtiaľ pochádza tabuľka *podpory rodín* na stránke o [MCAL](/docs/bsp/mcal).

### Dve úrovne: rodina a MCU

Vetva rieši rozdiel medzi *rodinami*. *Vnútri* rodiny je menší rozdiel: jednotlivé MCU majú rôzny počet portov (MCU v malom puzdre má menej portov GPIO než to vo veľkom puzdre). To sa rieši podmienkou na makrách, ktoré hlavičkový súbor zariadenia od výrobcu už definuje, nie vetvou:

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

a v typoch sa port, ktorý neexistuje, mapuje na hodnotu `GPIO_PORT_CNT`, takže ostatné moduly sa stále skompilujú a použitie takého portu sa dá rozpoznať ako neplatné. Pravidlo: **vetva pre inú rodinu, `#if defined` makra výrobcu pre iné MCU v tej istej rodine.**

## Čo získate

- **Iba kód danej rodiny.** Žiadne lesy `#ifdef`, nič nie je mŕtve a diff zmeny ukazuje iba kód, ktorý sa zostavuje.
- **Čisté oddelenie kódu výrobcu.** Ovládače ST pre každú rodinu sú zrkadlené vo vlastných vetvách RAL a nie sú upravované. Váš kód ich neobsahuje.
- **Stabilné rozhranie pre aplikáciu.** Aplikácia volá `Gpio_Set_PinLevel()` a nepozná rodinu, takže zmena MCU je iná vetva, nie prepísanie aplikácie.
- **Pripnuté verzie.** Projekt presne určuje, ktorý commit ktorej vetvy používa, takže aktualizácia je vedomé rozhodnutie.

## Čo to stojí: drift

Slabinou vetiev je, že žijú vlastným životom. Oprava urobená v jednej vetve nie je v ostatných, kým ju tam niekto neprenesie. Meranie vyššie ukazuje dve *generácie* toho istého modulu naraz. Vydané F4 (a H5, ktoré za ním nasleduje) má prepracovanú inicializáciu GPIO (výstupná úroveň sa nastaví *pred* prepnutím režimu pinu na výstup, aby pin negeneroval glitch), zdokumentované parametre a priečinok `Tests` s **unit testami a integračnými testami**. G4 a U5 nič z toho zatiaľ nemajú. Verejné rozhranie USART v `Usart_Port.h` to ukazuje ešte lepšie:

| Vetva | Verejné funkcie | V porovnaní s F4 |
|---|---|---|
| STM32F4 (vydaná) | 79 | referencia |
| STM32H5 | 79 | rovnaká sada funkcií, hlavička sa líši v 2 riadkoch |
| STM32G4 | 82 | 12 funkcií, ktoré F4 nemá (`Usart_StartTransmit`, `Usart_Set_TransmitBytes`, ...) a 9, ktoré F4 má a G4 nie (`Usart_Set_TxStart`, `Usart_Set_DataConfig`, ...) |
| STM32U5 | 83 | 13 funkcií len na U5, 9 len na F4 |

V tejto chvíli sa kód napísaný voči rozhraniu F4 skompiluje na H5 a neskompiluje na G4 a U5. Nie je to chyba prístupu, je to normálny stav platformy uprostred vydania. Ukazuje to však cenu: sľub „rovnaké rozhranie BSP pre všetky rodiny“ platí pre rodinu až **po vydaní jej vetvy** a čas medzi vydaním prvej a poslednej rodiny je obdobie, v ktorom sa vetvy od seba vzďaľujú. Počas neho by nikto nemal písať aplikáciu pre rodinu, ktorá nie je pripravená.

### Ako držať drift pod kontrolou

1. **Majte referenčnú vetvu a zoznam toho, čo je portované.** Jedna rodina vedie (tu F4), ostatné ju nasledujú a stav je viditeľný: je to tabuľka podpory rodín na stránke MCAL, rozšírená o „rovnakú verziu rozhrania ako referencia“.
2. **Urobte z vydania jednu operáciu.** Skript vydania, ktorý prejde všetky moduly jednej rodiny (tak, ako sa robí vydanie U5), je lepší než ručný merge: rodina je buď pripravená celá, alebo nie je.
3. **Merajte drift.** Skript nižšie porovná jeden modul na viacerých vetvách a vypíše počet zmenených riadkov na súbor. Nula alebo komentár znamená „rovnaké“, veľké číslo je práca, ktorá čaká. Trvá to sekundu a zmestí sa to do jobu CI.
4. **Nechajte jednu sadu testov kontrolovať všetky vetvy.** Unit testy, ktoré existujú na F4 (a H5), sú špecifikáciou modulu. Ak musí ten istý `Test_Gpio.c` prejsť na každej vetve rodiny, rozhranie sa nemôže potichu rozísť. Článok o [unit testovaní](/blog/unit-testing-unity-cmock) ukazuje, ako sa takýto test stavia.
5. **Držte rozdiel naspodku.** Všetko, čo sa dá presunúť do hlavičiek `Port` v RAL (jediný `#include`, ako je ukázané vyššie), je rozdiel, ktorý netreba udržiavať pre každú vetvu zvlášť. Čím viac kódu je *identického*, tým ľahšie je preniesť opravu z jednej vetvy do druhej (`git cherry-pick`).

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

Použité na vetvách modulu GPIO (tabuľka vyššie je jeho výstup):

```bash
./branch-drift.sh https://github.com/Embedbits/Bsp-Mcal-Gpio STM32F4 STM32G4 STM32H5 STM32U5
```

Pri ostatných moduloch je obraz iný, a to je užitočné vedieť skôr, než si naplánujete prácu:

```text
file             F4 vs G4   F4 vs H5   F4 vs U5
Exti_Port.h      0          0          0
Exti.c           586        538        682
Usart_Port.h     55         2          28
Usart.c          3734       2301       3927
```

EXTI má nezmenenú verejnú hlavičku na všetkých vetvách a odlišnú implementáciu (periférie sa líšia, rozhranie nie). USART sa líši v rozhraní na G4 a U5 a vo veľkej časti implementácie, čo je miera toho, koľko práce zaberie vydanie týchto dvoch.

## Ktorý prístup zvoliť

- **Vetvy na rodinu** sa hodia, keď sa rodiny líšia v *sade* periférií a v ovládačoch výrobcu, keď sa produkt zostavuje pre viac rodín a keď si môžete dovoliť udržiavať rozhranie (drift je zvládnuteľný pri niekoľkých rodinách a s nástrojom).
- **`#ifdef` v jednom strome** je prijateľný, keď sú rozdiely malé: jedna rodina s niekoľkými variantmi MCU, jediný register, ktorý sa volá inak.
- **Ani jeden z nich** nepomôže bez **abstrakcie naspodku**. Vetva len rozhoduje, ktorá implementácia rozhrania je v strome. Ak aplikácia includuje hlavičky výrobcu, vetva na rodinu vás pred ničím nezachráni.

A nech zvolíte čokoľvek, zapíšte si, ktorá rodina je referenčná, a držte v jobe CI jedno číslo: ako ďaleko sú ostatné.
