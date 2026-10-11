---
title: "Pravidlá MISRA C v praxi: čo sú zač, prečo existujú a ako s nimi žiť"
slug: misra-c-rules-in-practice
date: 2026-10-04T10:00:00
authors: [Mr.Nobody]
tags: [embedded, c, misra]
---

Povedzte „MISRA“ v miestnosti plnej embedded vývojárov a polovica z nich si vzdychne, zatiaľ čo druhá polovica sa opýta, aký nástroj používate. Povesť týchto pravidiel je rozporuplná: pre niekoho je to byrokracia, ktorá zje týždeň pred každým vydaním, pre iných dôvod, prečo sa auto na diaľnici nerestartuje. Obe skupiny majú sčasti pravdu.

V tomto článku prejdem pravidlá, s ktorými sa stretávam najčastejšie, jedno po druhom: čo pravidlo žiada, čo vám prinesie, ako vyzerá zlý kód, ako vyzerá dobrý kód a kto za vás problém nájde. Všetky príklady sú skutočný C kód, ktorý som skompiloval a spustil.

<!-- truncate -->

> **Poznámka k textom pravidiel**
>
> MISRA C je dokument chránený autorskými právami konzorcia MISRA. Jeho znenie tu nekopírujem. Každé pravidlo popisujem vlastnými slovami, s vlastnými príkladmi a citujem iba čísla a kategórie. Čísla sa vzťahujú na **MISRA C:2012** (MISRA C:2023 zhŕňa dodatky, zachováva tieto čísla a pridáva niekoľko nových smerníc). Skôr než na tomto článku postavíte čokoľvek ďalšie, overte si pravidlo vo vlastnej kópii normy, ktorú získate na [misra.org.uk](https://misra.org.uk). Tento článok je nezávislý a MISRA ho neschválila.

## Čo je MISRA C (a čo nie je)

MISRA je skratka z *Motor Industry Software Reliability Association*. Prvé smernice pre jazyk C vyšli v roku 1998 pre automobilový priemysel, dnes sa používajú v letectve, železničnej doprave, zdravotníckych pomôckach a priemyselnej automatizácii, teda všade, kde porucha softvéru niekomu ublíži.

Hlavná myšlienka je jednoduchá. C je jazyk, ktorý dovoľuje veľa vecí, ktoré sú legálne, ale nebezpečné: nedefinované správanie (undefined behaviour), správanie definované implementáciou, implicitné konverzie, ktoré menia hodnoty, ukazovatele, ktoré môžu ukazovať kamkoľvek. MISRA definuje **podmnožinu jazyka C**, v ktorej sú nebezpečné časti zakázané alebo ich treba zdôvodniť. Nie je to iný jazyk, program vyhovujúci MISRA je stále normálny C program, ktorý vám zostaví váš bežný kompilátor.

Čo MISRA **nie je**:

- Nie je to certifikácia. „Vyhovuje MISRA“ je tvrdenie, ktoré sami uvádzate a dokumentujete, nikto váš kód neopečiatkuje.
- Nie je to záruka správnosti. Pravidlá odstraňujú triedy chýb, nekontrolujú, či termostat skutočne reguluje teplotu.
- Nie je to o štýle. Pomenovanie, odsadenie a organizácia súborov nie sú súčasťou MISRA, na to slúži [coding style](/docs/platform/embi-platform/coding-style).

### Ako čítať pravidlo

Každá smernica má tri vlastnosti, ktoré by ste mali poznať skôr, než prečítate prvú z nich:

| Vlastnosť | Hodnoty | Význam |
|---|---|---|
| **Druh** | *Directive* / *Rule* | Pravidlo (rule) sa dá skontrolovať samotným zdrojovým kódom. Smernica (directive) potrebuje viac informácií (návrh, proces), takže nástroj môže pomôcť, ale nerozhodne. |
| **Kategória** | *Mandatory* / *Required* / *Advisory* | Mandatory: žiadna výnimka. Required: výnimka je možná s písomným zdôvodnením. Advisory: odporúčanie, stačí zaznamenať, že ho nedodržiavate. |
| **Rozhodnuteľnosť** | *Decidable* / *Undecidable* | Či nástroj dokáže dať presnú odpoveď. Pri nerozhodnuteľných pravidlách aj najlepší analyzátor produkuje falošné poplachy alebo niečo prehliadne. |

Číslovanie je `Dir 4.12` pre smernice a `Rule 9.1` pre pravidlá, kde prvé číslo je téma (9 = inicializácia, 10 = typy, 11 = ukazovatele, ...).

## Pravidlá jedno po druhom

Zoskupil som ich podľa problému, ktorý riešia, nie podľa čísla.

### Pravidlá o hodnotách, ktoré nie sú také, ako si myslíte

#### Rule 9.1 - čítanie až po zápise (Mandatory)

**Pravidlo:** nečítajte premennú s automatickou dobou trvania skôr, než jej bola priradená hodnota.

**Čo získate:** hodnota takej premennej je náhodný odpad a pri inom kompilátore alebo úrovni optimalizácie je to *iný* odpad. Chyby typu „v debugu funguje, v release nie“ sa veľmi často končia tu. Keďže je pravidlo mandatory, výnimka nie je možná.

Zlé, premenná sa nastaví iba na jednej ceste:

```c
uint8_t Gain_Bad(bool isHigh)
{
    uint8_t gain;
    if (isHigh) { gain = 8u; }
    return gain;                       /* indeterminate value when isHigh is false */
}
```

Dobré, každá cesta má definovanú hodnotu:

```c
uint8_t Gain_Good(bool isHigh)
{
    uint8_t gain = 1u;
    if (isHigh) { gain = 8u; }
    return gain;
}
```

**Kto to nájde:** kompilátor niekedy (`-Wall -Wmaybe-uninitialized` s optimalizáciou), statický analyzátor spoľahlivo. V mojom testovacom builde gcc pri tejto funkcii mlčal. Nespoliehajte sa naň.

#### Rules 10.1, 10.3, 10.4 - essential types (Required)

**Pravidlá:** autori MISRA vymysleli *model essential types*: typ, ktorý výraz *vyzerá, že má* (`uint8_t` zostáva v ich pohľade „unsigned 8 bit“), na rozdiel od typu, ktorý C potichu používa (`int`, kvôli integer promotion). Pravidlá zakazujú operácie medzi nevhodnými typmi, priradenie hodnoty do užšieho typu a miešanie kategórií (signed, unsigned, boolean, character, floating).

**Čo získate:** integer promotion sú najväčším zdrojom prekvapení v embedded C. Všetky hodnoty menšie než `int` sa pred akoukoľvek aritmetikou povýšia na `int` a vy to nevidíte. Dva klasické dôsledky:

```c
bool Flags_Bad(uint8_t flags)
{
    return (~flags == 0xF0u);          /* ~flags is an int: 0xFFFFFFF0 - never equal */
}
```

`~flags` nie je 8-bitová hodnota, je to `int` s hodnotou `0xFFFFFFF0`. Porovnanie nikdy neuspeje, nech je argument akýkoľvek. Oprava je povedať, čo myslíte:

```c
bool Flags_Good(uint8_t flags)
{
    return ((uint8_t)~flags == 0xF0u);
}
```

Druhý klasický prípad je tiché zúženie:

```c
uint8_t Add_Bad(uint8_t first, uint8_t second)
{
    uint8_t sum = first + second;      /* int result silently narrowed */
    return sum;
}
```

`200 + 100` sa vypočíta ako `int` (300) a priradenie do `uint8_t` ponechá iba 44. Žiadne varovanie, žiadna chyba, nesprávny súčet. Dva správne varianty: rozšíriť výsledok, alebo pretypovať zámerne a rozmyslieť si pretečenie.

```c
uint16_t Add_Good(uint8_t first, uint8_t second)
{
    uint16_t sum = (uint16_t)first + (uint16_t)second;
    return sum;
}
```

**Kto to nájde:** dobrý statický analyzátor. Kompilátor pomáha len čiastočne: `-Wsign-compare` (súčasť `-Wextra`) ohlásil prvý príklad, zatiaľ čo pri druhom gcc mlčal.

#### Directive 4.6 - typy s veľkosťou a znamienkom (Advisory)

**Smernica:** namiesto `char`, `short`, `int` a `long` používajte typedefy, ktoré hovoria o veľkosti a znamienku (`uint8_t`, `int32_t` alebo vlastné názvy).

**Čo získate:** šírka `int` závisí od kompilátora a MCU: 16 bitov na malých 8- a 16-bitových kontroléroch, 32 bitov na Cortex-M. Kód, ktorý funguje na jednom cieli, sa na inom potichu zmení. S typmi pevnej šírky je v zdrojáku vidieť, čo kód robí. V mojich projektoch idem o krok ďalej a vytváram vlastné názvy typov pre fyzikálne veličiny (`temperature_t`, `humidity_t`), aby ma kompilátor zastavil, keď ich pomiešam.

```c
int counter;       /* 16 or 32 bits? the answer depends on the target */
uint16_t counter;  /* 16 bits everywhere */
```

#### Rule 1.3 - žiadne nedefinované správanie (Required)

**Pravidlo:** program nesmie obsahovať nedefinované správanie. Patrí sem pretečenie so znamienkom, posuny o príliš veľa bitov, delenie nulou, použitie visiaceho ukazovateľa a mnoho ďalšieho.

**Čo získate:** pri nedefinovanom správaní môže kompilátor urobiť *čokoľvek*, vrátane odstránenia vašej bezpečnostnej kontroly, pretože „tento prípad nemôže nastať“. Najznámejším príkladom je pretečenie so znamienkom: `first + second` na `int32_t`, ktoré sa nezmestí, nie je „zalomenie“, je to povolenie pre optimalizátor.

```c
int32_t Add_Bad2(int32_t first, int32_t second)
{
    return first + second;             /* signed overflow is undefined behaviour */
}
```

Správny kód skontroluje podmienku *pred* operáciou a nahlási problém volajúcemu:

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

To isté platí pre posuny. Maska bitovej pozície je definovaná iba vtedy, ak je pozícia menšia než šírka typu:

```c
uint32_t Bit_Mask(uint8_t position)
{
    return (position < 32u) ? (1u << position) : 0u;
}
```

**Kto to nájde:** sčasti kompilátor (`-fsanitize=undefined` to počas testov nájde za behu), sčasti analyzátor. Pravidlo je vo všeobecnosti nerozhodnuteľné: nástroj vám dokáže ukázať všetky miesta, ktoré by mohli byť problém.

### Pravidlá o podmienkach a riadení toku

#### Rule 14.4 - riadiaci výraz je boolean (Required)

**Pravidlo:** podmienka v `if`, `while` a `for` musí byť výraz s essential typom Boolean, t. j. výsledok porovnania alebo `bool`. Samotné celé číslo alebo ukazovateľ nie je povolené.

**Čo získate:** zámer je čitateľný. `while (count)` nehovorí, či chcete „kým nie je nula“, alebo „kým nie je koniec“. Explicitný tvar vyzerá rovnako pre čísla, ukazovatele aj príznaky. (Konštantu píšem na ľavú stranu, `0u != count`, aby sa preklep s jedným `=` neskompiloval.)

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

**Kto to nájde:** každý analyzátor MISRA, je to rozhodnuteľné pravidlo.

#### Rule 12.1 - explicitná precedencia operátorov (Advisory)

**Pravidlo:** nespoliehajte sa, že si čitateľ (a vy sami) zapamätá tabuľku precedencie, používajte zátvorky.

**Čo získate:** precedencia `&` a `==` v C je opačná, než čaká ľudský mozog. Toto je chyba, ktorú napíše každý aspoň raz:

```c
bool Masked_Bad(uint8_t flags)
{
    return (flags & MASK == MASK);     /* == binds stronger than & */
}
```

`MASK == MASK` sa vyhodnotí ako prvé a dá `1`, takže funkcia testuje bit 0 a nie masku. Vráti `true` pre `0x01` a `false` pre `0x0C`, presne naopak. So zátvorkami chyba nemôže vzniknúť:

```c
bool Masked_Good(uint8_t flags)
{
    return ((flags & MASK) == MASK);
}
```

**Kto to nájde:** kompilátor (`-Wparentheses` je súčasť `-Wall`) a každý analyzátor.

#### Rules 15.6, 15.7, 16.3 a 16.4 - úplné príkazy (Required)

**Pravidlá:**

- 15.6: telo `if`, `else`, `for`, `while` je vždy blok v zložených zátvorkách,
- 15.7: každý reťazec `if ... else if` končí vetvou `else`,
- 16.3: každá vetva `switch` končí `break` (alebo iným bezpodmienečným skokom),
- 16.4: každý `switch` má `default`.

**Čo získate:** pravidlá vás nútia odpovedať na otázku „čo sa stane vo všetkých ostatných prípadoch?“ v okamihu, keď kód píšete, a nie v teréne. `switch` bez `break` je klasická chyba, `enum`, ktorý dostane novú hodnotu bez `default`, je druhá. Zložené zátvorky odstraňujú celú rodinu chýb, keď sa pod `if` pridá druhý príkaz a vyzerá, že je podmienený:

```c
if (isError)
    Led_On();
    Buzzer_On();      /* indented like it belongs to the if - it does not */
```

A tu je switch. Prvá verzia prepadne z `MODE_ON` do `MODE_ERROR` a nastaví zlú hodnotu, druhá ošetrí každý prípad explicitne:

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

V mojom teste gcc našiel chýbajúci `default` aj prepadnutie (`-Wswitch-default -Wimplicit-fallthrough`). Pravidlo o `else` a zložené zátvorky kontroluje analyzátor alebo formátovač.

#### Rule 17.2 - žiadna rekurzia (Required)

**Pravidlo:** funkcia nesmie volať samu seba, ani priamo, ani cez iné funkcie.

**Čo získate:** na PC má zásobník megabajty. Na mikrokontroléri máte pár kilobajtov a najhorší prípad hĺbky rekurzie závisí od vstupných dát. Ak rekurziu odstránite, maximálne využitie zásobníka sa dá *vypočítať* (stačí statická analýza stromu volaní) a pretečenie zásobníka prestane byť prekvapením.

```c
uint32_t Factorial_Recursive(uint32_t value)
{
    return (value <= 1u) ? 1u : value * Factorial_Recursive(value - 1u);
}
```

Iteratívna verzia potrebuje konštantné množstvo zásobníka:

```c
uint32_t Factorial_Iterative(uint32_t value)
{
    uint32_t result = 1u;
    for (uint32_t factor = 2u; factor <= value; factor++) { result *= factor; }
    return result;
}
```

**Kto to nájde:** analyzátor a linker map (niektoré toolchainy vypíšu graf volaní, `-fstack-usage` povie veľkosť každého rámca).

### Pravidlá o pamäti a ukazovateľoch

#### Directive 4.12 a Rule 21.3 - žiadna dynamická pamäť (Required)

**Pravidlo:** nepoužívajte `malloc`, `calloc`, `realloc` a `free`.

**Čo získate:**

- halda sa *fragmentuje*. Po týždňoch behu môže zlyhať požiadavka na 64 bajtov, hoci je voľných 10 kB, len nie v jednom kuse,
- doba vykonania `malloc` nie je deterministická,
- únik pamäte po týždňoch behu je najhorší druh chyby, aký sa dá hľadať,
- spotreba pamäte je známa v čase linkovania, nie o 3. ráno v teréne.

Štandardnou alternatívou je pool s pevnou veľkosťou, ktorý má rovnaký tvar API ako alokátor:

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

Funkcia vráti `NULL`, ak sú všetky rámce obsadené, takže prípad „nie je pamäť“ je v kóde ošetrený a dá sa testovať na PC. Presne to isté sa deje pri `malloc`, len to otestovať nemôžete, pretože na vašom PC alokácia nikdy nezlyhá.

**Kto to nájde:** analyzátor, alebo jednoducho linker, ktorý `malloc` vôbec nelinkuje.

#### Rules 11.3 a 11.5 - opatrne s pretypovaním ukazovateľov (Required / Advisory)

**Pravidlá:** nepretypúvajte ukazovateľ na objekt jedného typu na ukazovateľ na objekt iného typu (11.3) a vyhýbajte sa konverzii z `void *` na ukazovateľ na objekt (11.5).

**Čo získate:** pretypovanie bajtového bufferu na `uint32_t *` je najčastejší spôsob, ako prečítať pole komunikačného rámca:

```c
uint32_t ReadU32_Bad(const uint8_t *buffer)
{
    return *(const uint32_t *)buffer;  /* misaligned access, strict aliasing violation */
}
```

Je to nedefinované správanie hneď dvakrát. Adresa nemusí byť zarovnaná na štyri bajty (hard fault na Cortex-M0, pomalý prístup inde) a prístup cez ukazovateľ iného typu porušuje pravidlá aliasingu, takže ho optimalizátor môže preusporiadať alebo zahodiť. Dve správne riešenia: `memcpy` (kompilátor ho zmení na jediné načítanie, kde to hardvér dovoľuje) alebo poskladanie bajtov, ktoré zároveň vyrieši poradie bajtov a nezávisí od endianity CPU:

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

Pretypovanie `void *` je typické pre generický kontext callbacku. Je advisory, pretože v C je to niekedy jediná cesta. Prínosom pravidla je, že si všimnete každé takéto miesto a pretypovanie urobíte na jedinom riadku na začiatku funkcie (ako v [článku o SOLID](/blog/solid-principles-c-cpp)), a nie všade.

**Kto to nájde:** každý analyzátor. Kompilátor nájde pretypovanie len na niektorých cieľoch a s `-Wcast-align`.

#### Rule 8.13 - ukazovateľ na const, keď sa dá (Advisory)

**Pravidlo:** ak funkcia nemení dáta za ukazovateľom, ukazovateľ sa deklaruje ako ukazovateľ na `const`.

**Čo získate:** signatúra je zmluva. Volajúci vidí z prototypu, že funkcia iba číta, a kompilátor to stráži. `const` buffer z flash sa dá odovzdať iba funkcii s `const`, inak sa kód neskompiluje (alebo ešte horšie, zapíše do flash a spôsobí fault).

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

### Pravidlá o kóde, ktorý ste napísali, a kóde, ktorý tam nie je

#### Rule 17.7 a Directive 4.7 - neignorujte výsledky (Required)

**Pravidlá:** vrátená hodnota sa musí použiť (17.7) a keď funkcia vracia chybový kód, musí sa otestovať (4.7).

**Čo získate:** ignorovaná návratová hodnota je ignorovaná chyba. Odoslanie rámca na zaneprázdnené UART, odmietnutý zápis do flash, timeout I2C: všetko to potichu prejde a aplikácia pokračuje s nesprávnym predpokladom. Ak vám na tom naozaj nezáleží, povedzte to cez `(void)`, aby čitateľ (a analyzátor) vedel, že to bolo rozhodnutie a nie chyba:

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

**Kto to nájde:** analyzátor, v gcc s `__attribute__((warn_unused_result))` na vlastnom API.

#### Rules 2.1 a 2.2 - žiadny nedosiahnuteľný ani mŕtvy kód (Required)

**Pravidlá:** projekt nesmie obsahovať kód, ktorý sa nikdy nemôže vykonať (2.1), a kód, ktorý sa vykoná, ale nemá vplyv na výsledok (2.2).

**Čo získate:** oba druhy sú signálom chyby: podmienka, ktorá nikdy nenastane, zabudnutý `return` alebo chyba z copy-paste. Mŕtvy kód tiež falšuje pokrytie testami (nemôžete dosiahnuť 100 % riadkov, ktoré nevykoná žiadny vstup) a núti čitateľa o ňom premýšľať. Oba sa objavujú v tejto funkcii:

```c
uint8_t Level_Get(uint8_t raw)
{
    uint8_t level = 3u;                /* dead: overwritten before it is read */
    level = (uint8_t)(raw / 2u);
    return level;
    Level_Log(raw);                    /* unreachable */
}
```

Prvé priradenie `level` je mŕtve a posledný riadok je nedosiahnuteľný.

**Kto to nájde:** analyzátor. gcc s `-Wall -Wextra` v mojom teste mlčal.

#### Rule 20.7 a Directive 4.9 - makrá s parametrami (Required / Advisory)

**Pravidlo:** rozvinutý parameter makra musí byť v zátvorkách (20.7) a funkcia je preferovaná pred makrom podobným funkcii (4.9).

**Čo získate:** makro je textová náhrada. Ak parameter nechránite, rozhodne precedencia *volajúceho*:

```c
#define SQUARE_BAD(x)  x * x
#define SQUARE_OK(x)   ((x) * (x))

SQUARE_BAD(2 + 1)   /* 2 + 1 * 2 + 1 = 5, not 9 */
SQUARE_OK(2 + 1)    /* ((2 + 1) * (2 + 1)) = 9 */
```

Aj chránené makro má problém: `SQUARE_OK(count++)` inkrementuje dvakrát. Preto smernica 4.9 odporúča funkciu. Inline funkcia má typ, vyhodnotí argument raz a stojí rovnako:

```c
static inline uint32_t Square(uint32_t value) { return value * value; }
```

## MISRA v reálnom projekte

### Varovania kompilátora sú prvý krok, nie posledný

Všetky vyššie uvedené príklady som skompiloval s `gcc -Wall -Wextra -Wconversion -Wshadow -Wswitch-default -Wimplicit-fallthrough -O2`. gcc nahlásil päť varovaní a týkajú sa iba troch „zlých“ príkladov: porovnania s povýšeným doplnkom, `switch` (chýbajúci `default`, neošetrená hodnota enumu a prepadnutie) a chýbajúcich zátvoriek okolo `==` pri teste masky. Mlčal o zúžení, neinicializovanej premennej, mŕtvom a nedosiahnuteľnom kóde, pretečení so znamienkom, rekurzii, pretypovaní ukazovateľa a makre.

Moje odporúčanie je kompilátor s maximom varovaní a `-Werror` v CI ako základ. Je to zadarmo a odstráni najzrejmejšie problémy, ale nenahrádza statickú analýzu.

### Vyberte nástroj a dajte ho do CI

Na kontrolu pravidiel potrebujete statický analyzátor. Existujú komerčné (Polyspace, Helix QAC, PC-lint Plus, Coverity, Parasoft C/C++test, LDRA, IAR C-STAT a ďalšie) aj bezplatné, ktoré pokrývajú časť pravidiel, napríklad [cppcheck](https://cppcheck.sourceforge.io/) s doplnkom pre MISRA. Doplnok potrebuje na vstupe text pravidiel a kvôli autorským právam ho musíte dodať z vlastnej kópie normy. Nástroj nie je nikdy dokonalý: pri nerozhodnuteľných pravidlách budete mať falošné poplachy a niekedy sa porušenie prehliadne.

Kontrola patrí do CI pri každom commite, nie do manuálneho behu pred vydaním. Inak tú istú prácu robíte trikrát: raz keď píšete, raz keď sa nájdu porušenia a raz keď ich opravujete.

### Výnimky sú súčasťou systému

Niekedy sa pravidlo musí porušiť. Prístup k hardvérovému registru potrebuje pretypovanie celého čísla na ukazovateľ, bootloader potrebuje zapisovať do flash cez ukazovateľ. MISRA to pozná a definuje **deviation** (výnimku): záznam s pravidlom, miestom, dôvodom a posúdením rizika. Záznam by mal byť hneď vedľa kódu:

```c
/* MISRA deviation: Rule 11.4 (Advisory), see DEV-012
 * Reason: the address of the peripheral register is fixed by the hardware.
 * Contained in this macro, the rest of the code uses the register type. */
#define UART_REGS ((uartRegisters_t *)0x40004400u)
```

Výnimka nie je zlyhanie. Zoznam dobre odôvodnených výnimiek je znakom projektu, v ktorom ľudia premýšľajú. Projekt s nulou výnimiek a bez prístupu k hardvéru buď klame, alebo je veľmi malý.

### Legacy kód a kód od výrobcu

200 000 riadkov starého projektu nespravíte vyhovujúcich za týždeň. Čo funguje:

1. **Starý kód nechajte na pokoji,** zapnite kontrolu pre *nové a zmenené* súbory. Baseline analyzátora uloží existujúce porušenia a CI zlyhá iba na nových.
2. **Začnite s pravidlami mandatory a required,** advisory neskôr.
3. **Vylúčte kód tretích strán** a zdokumentujte to. Generovaný kód od výrobcu (HAL, LL, CMSIS) nie je vaša vec opravovať. To je ďalší dôvod pre vrstvovú architektúru z článku o [dizajne a architektúre](/blog/design-architecture): keď kód výrobcu sedí v RAL a MCAL a všetko nad ním je váš kód, hranicou kontroly je priečinok.

### Čo nepomáha

- **Naháňanie počtu porušení.** Pravidlo opravené spôsobom, ktorý uspokojí nástroj a pokazí zmysel (pretypovanie pridané iba na umlčanie varovania), je horšie než pôvodný stav.
- **Používanie MISRA ako argumentu.** „MISRA to hovorí“ nie je dôvod. Ak neviete vysvetliť, pred čím vás pravidlo chráni, nebudete vedieť rozhodnúť, kedy je čas na výnimku.
- **Viera, že vyhovenie znamená správnosť.** MISRA robí niektoré chyby nemožnými. Požiadavky, architektúra, review a testy zostávajú na vás.

## Zhrnutie

| Pravidlo | Skrátene | Prínos |
|---|---|---|
| 9.1 | Inicializovať pred čítaním | Žiadne náhodné hodnoty, rovnaké správanie v debugu a release |
| 10.x | Rešpektovať essential types | Žiadne prekvapenia z integer promotion a zúženia |
| Dir 4.6 | Typy pevnej šírky | Rovnaký kód znamená to isté na každom cieli |
| 1.3 | Žiadne nedefinované správanie | Optimalizátor nemôže odstrániť vaše kontroly |
| 14.4 | Explicitné podmienky | Zámer je čitateľný |
| 12.1 | Zátvorky | Žiadne chyby precedencie |
| 15.6, 15.7, 16.3, 16.4 | Zložené zátvorky, `else`, `break`, `default` | Každý prípad je ošetrený |
| 17.2 | Žiadna rekurzia | Využitie zásobníka sa dá vypočítať |
| Dir 4.12, 21.3 | Žiadna dynamická pamäť | Žiadna fragmentácia, úniky a prekvapenia v časovaní |
| 11.3, 11.5 | Žiadne triky s typmi ukazovateľov | Žiadne chyby zarovnania a aliasingu |
| 8.13 | Ukazovatele `const` | Signatúra je zmluva |
| 17.7, Dir 4.7 | Používať návratové hodnoty | Chyby nezmiznú |
| 2.1, 2.2 | Žiadny nedosiahnuteľný ani mŕtvy kód | Chyby sú viditeľné, pokrytie má zmysel |
| 20.7, Dir 4.9 | Bezpečné makrá, preferovať funkcie | Žiadne skryté dvojité vyhodnotenie ani chyby precedencie |

Ak si zapamätáte jedinú vec: **pravidlo MISRA je jazva po chybe, ktorú už niekto mal.** Nemusíte tie pravidlá mať radi, ale je dobré vedieť, po čom je každé z nich jazvou. Potom budete vedieť, kedy ho dodržať a kedy napísať výnimku a prevziať zodpovednosť.

Tu opísané pravidlá sú len výber. Celá sada má viac než 140 smerníc a zvyšok (preprocesor, štandardná knižnica, štruktúra deklarácií) stojí za to raz prečítať vo vlastnej kópii normy.
