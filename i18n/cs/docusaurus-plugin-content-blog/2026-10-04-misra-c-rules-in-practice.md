---
title: "Pravidla MISRA C v praxi: co jsou zač, proč existují a jak s nimi žít"
slug: misra-c-rules-in-practice
date: 2026-10-04T10:00:00
authors: [Mr.Nobody]
tags: [embedded, c, misra]
---

Řekněte „MISRA“ v místnosti plné embedded vývojářů a polovina si povzdechne, zatímco druhá se zeptá, jaký nástroj používáte. Pověst těchto pravidel je rozporuplná: pro některé je to byrokracie, která před každým vydáním sežere týden, pro jiné důvod, proč se auto na dálnici nerestartuje. Obě skupiny mají zčásti pravdu.

V tomto článku projdu pravidla, se kterými se setkávám nejčastěji, jedno po druhém: co pravidlo požaduje, co za to získáte, jak vypadá špatný kód, jak vypadá dobrý kód a kdo za vás problém najde. Všechny příklady jsou skutečný C kód, který jsem přeložil a spustil.

<!-- truncate -->

> **Poznámka k textům pravidel**
>
> MISRA C je dokument chráněný autorskými právy konsorcia MISRA. Jeho znění zde nekopíruji. Každé pravidlo popisuji vlastními slovy a vlastními příklady, citována jsou pouze čísla a kategorie. Čísla se vztahují k normě **MISRA C:2012** (MISRA C:2023 shrnuje dodatky, ponechává tato čísla a přidává několik nových směrnic). Než na tomto článku postavíte cokoli důležitého, ověřte si pravidlo ve vlastním výtisku normy, který získáte na [misra.org.uk](https://misra.org.uk). Tento článek je nezávislý a MISRA ho neschvaluje.

## Co je MISRA C (a co není)

MISRA je zkratka pro *Motor Industry Software Reliability Association*. První směrnice pro jazyk C vyšly v roce 1998 pro automobilový průmysl, dnes se používají v letectví, na železnici, ve zdravotnických prostředcích a v průmyslové automatizaci, tedy v podstatě všude, kde selhání softwaru někomu ublíží.

Základní myšlenka je jednoduchá. C je jazyk, který dovoluje spoustu věcí, jež jsou legální, ale nebezpečné: nedefinované chování, chování definované implementací, implicitní konverze měnící hodnoty, ukazatele, které mohou mířit kamkoli. MISRA definuje **podmnožinu jazyka C**, ve které jsou nebezpečné části zakázané nebo je nutné je zdůvodnit. Není to jiný jazyk. Program vyhovující MISRA je pořád normální C program, který váš běžný překladač přeloží.

Čím MISRA **není**:

- Není to certifikace. „Vyhovuje MISRA“ je tvrzení, které sami vyslovíte a zdokumentujete, nikdo váš kód neopatří razítkem.
- Není to záruka správnosti. Pravidla odstraňují třídy chyb, ale nekontrolují, že termostat opravdu reguluje teplotu.
- Nejde o styl. Pojmenování, odsazení a organizace souborů nejsou součástí MISRA, od toho je [coding style](/docs/platform/embi-platform/coding-style).

### Jak číst pravidlo

Každá směrnice má tři vlastnosti, které byste měli znát dřív, než přečtete první z nich:

| Vlastnost | Hodnoty | Význam |
|---|---|---|
| **Druh** | *Directive* / *Rule* | Pravidlo (rule) lze ověřit pouhým pohledem na zdrojový kód. Direktiva (directive) potřebuje další informace (návrh, proces), takže nástroj může pomoci, ale nemůže rozhodnout. |
| **Kategorie** | *Mandatory* / *Required* / *Advisory* | Mandatory: žádná výjimka. Required: výjimka je možná s písemným zdůvodněním. Advisory: doporučení, stačí zaznamenat, že se jím neřídíte. |
| **Rozhodnutelnost** | *Decidable* / *Undecidable* | Zda nástroj dokáže dát přesnou odpověď. U nerozhodnutelných pravidel i nejlepší analyzátor produkuje falešné poplachy nebo něco přehlédne. |

Číslování je `Dir 4.12` pro direktivy a `Rule 9.1` pro pravidla, kde první číslo označuje téma (9 = inicializace, 10 = typy, 11 = ukazatele, ...).

## Pravidla jedno po druhém

Seskupil jsem je podle problému, který řeší, ne podle čísla.

### Pravidla o hodnotách, které nejsou takové, jak si myslíte

#### Rule 9.1 - čti až po zápisu (Mandatory)

**Pravidlo:** nečtěte proměnnou s automatickou dobou trvání dřív, než jí byla přiřazena hodnota.

**Co za to získáte:** hodnota takové proměnné je smetí a na jiném překladači nebo s jinou úrovní optimalizace je to *jiné* smetí. Chyby typu „v debugu funguje, v release selhává“ končí velmi často právě tady. Protože je pravidlo mandatory, výjimka není možná.

Špatně, proměnná se nastaví jen na jedné cestě:

```c
uint8_t Gain_Bad(bool isHigh)
{
    uint8_t gain;
    if (isHigh) { gain = 8u; }
    return gain;                       /* indeterminate value when isHigh is false */
}
```

Dobře, každá cesta má definovanou hodnotu:

```c
uint8_t Gain_Good(bool isHigh)
{
    uint8_t gain = 1u;
    if (isHigh) { gain = 8u; }
    return gain;
}
```

**Kdo to najde:** překladač občas (`-Wall -Wmaybe-uninitialized` s optimalizací), statický analyzátor spolehlivě. V mém testovacím buildu gcc u této funkce mlčel. Nespoléhejte na něj.

#### Rules 10.1, 10.3, 10.4 - essential types (Required)

**Pravidla:** autoři MISRA vymysleli *model essential types*: typ, který výraz *vypadá, že má* (`uint8_t` zůstává z jejich pohledu „unsigned 8 bit“), na rozdíl od typu, který C potichu používá (`int`, kvůli integer promotion). Pravidla zakazují operace mezi nevhodnými typy, přiřazení hodnoty do užšího typu a míchání kategorií (signed, unsigned, boolean, character, floating).

**Co za to získáte:** integer promotions jsou největším zdrojem překvapení v embedded C. Všechny hodnoty menší než `int` se před jakoukoli aritmetikou povýší na `int` a vy to nevidíte. Dva klasické výsledky:

```c
bool Flags_Bad(uint8_t flags)
{
    return (~flags == 0xF0u);          /* ~flags is an int: 0xFFFFFFF0 - never equal */
}
```

`~flags` není 8bitová hodnota, ale `int` s hodnotou `0xFFFFFFF0`. Porovnání nikdy neuspěje, ať je argument jakýkoli. Řešením je říct, co myslíte:

```c
bool Flags_Good(uint8_t flags)
{
    return ((uint8_t)~flags == 0xF0u);
}
```

Druhým klasikem je tiché zúžení:

```c
uint8_t Add_Bad(uint8_t first, uint8_t second)
{
    uint8_t sum = first + second;      /* int result silently narrowed */
    return sum;
}
```

`200 + 100` se spočítá jako `int` (300) a přiřazení do `uint8_t` zachová jen 44. Žádné varování, žádná chyba, špatný součet. Dvě správné varianty: rozšířit výsledek, nebo přetypovat záměrně a promyslet přetečení.

```c
uint16_t Add_Good(uint8_t first, uint8_t second)
{
    uint16_t sum = (uint16_t)first + (uint16_t)second;
    return sum;
}
```

**Kdo to najde:** dobrý statický analyzátor. Překladač pomůže jen částečně: `-Wsign-compare` (součást `-Wextra`) ohlásil první příklad, zatímco u druhého gcc mlčel.

#### Directive 4.6 - typy s velikostí a znaménkovostí (Advisory)

**Direktiva:** místo `char`, `short`, `int` a `long` používejte typedefy, které říkají velikost a znaménkovost (`uint8_t`, `int32_t` nebo vlastní názvy).

**Co za to získáte:** šířka `int` závisí na překladači a MCU: 16 bitů na malých 8bitových a 16bitových řadičích, 32 bitů na Cortex-M. Kód, který funguje na jednom cíli, se na jiném potichu změní. S typy pevné šířky je ve zdrojovém kódu vidět, co kód dělá. Ve svých projektech jdu o krok dál a vytvářím vlastní názvy typů pro fyzikální veličiny (`temperature_t`, `humidity_t`), aby mě překladač zastavil, když je promíchám.

```c
int counter;       /* 16 or 32 bits? the answer depends on the target */
uint16_t counter;  /* 16 bits everywhere */
```

#### Rule 1.3 - žádné nedefinované chování (Required)

**Pravidlo:** program nesmí obsahovat nedefinované chování. To zahrnuje přetečení se znaménkem, posuny o příliš mnoho bitů, dělení nulou, použití visícího ukazatele a mnoho dalšího.

**Co za to získáte:** při nedefinovaném chování může překladač udělat *cokoli*, včetně odstranění vaší bezpečnostní kontroly, protože „tento případ nemůže nastat“. Nejznámějším příkladem je přetečení se znaménkem: `first + second` na `int32_t`, které se nevejde, není „přetečení dokola“, ale licence pro optimalizátor.

```c
int32_t Add_Bad2(int32_t first, int32_t second)
{
    return first + second;             /* signed overflow is undefined behaviour */
}
```

Správný kód ověří podmínku *před* operací a nahlásí problém volajícímu:

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

Totéž platí pro posuny. Maska bitové pozice je definovaná jen tehdy, je-li pozice menší než šířka typu:

```c
uint32_t Bit_Mask(uint8_t position)
{
    return (position < 32u) ? (1u << position) : 0u;
}
```

**Kdo to najde:** částečně překladač (`-fsanitize=undefined` to za běhu najde během testů), částečně analyzátor. Pravidlo je obecně nerozhodnutelné: nástroj vám může ukázat všechna místa, která by mohla být problém.

### Pravidla o podmínkách a řízení toku

#### Rule 14.4 - řídicí výraz je boolean (Required)

**Pravidlo:** podmínka v `if`, `while` a `for` musí být výraz s essential typem Boolean, tedy výsledek porovnání nebo `bool`. Samotné celé číslo nebo ukazatel nejsou povoleny.

**Co za to získáte:** záměr je čitelný. `while (count)` neříká, zda chcete „dokud to není nula“, nebo „dokud to není konec“. Explicitní tvar vypadá stejně pro čísla, ukazatele i příznaky. (Konstantu píšu vlevo, `0u != count`, takže překlep s jedním `=` se nepřeloží.)

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

**Kdo to najde:** každý analyzátor MISRA, jde o rozhodnutelné pravidlo.

#### Rule 12.1 - zviditelněte prioritu operátorů (Advisory)

**Pravidlo:** nespoléhejte na to, že si čtenář (a vy sami) pamatuje tabulku priorit, používejte závorky.

**Co za to získáte:** priorita `&` a `==` je v C opačná, než čeká lidský mozek. Tuto chybu napsal každý aspoň jednou:

```c
bool Masked_Bad(uint8_t flags)
{
    return (flags & MASK == MASK);     /* == binds stronger than & */
}
```

`MASK == MASK` se vyhodnotí jako první a dá `1`, takže funkce testuje bit 0 a ne masku. Pro `0x01` vrátí `true` a pro `0x0C` `false`, přesně obráceně. Se závorkami chyba nemůže vzniknout:

```c
bool Masked_Good(uint8_t flags)
{
    return ((flags & MASK) == MASK);
}
```

**Kdo to najde:** překladač (`-Wparentheses` je součástí `-Wall`) i každý analyzátor.

#### Rules 15.6, 15.7, 16.3 a 16.4 - úplné příkazy (Required)

**Pravidla:**

- 15.6: tělo `if`, `else`, `for`, `while` je vždy blok ve složených závorkách,
- 15.7: každý řetězec `if ... else if` končí větví `else`,
- 16.3: každá klauzule `switch` končí příkazem `break` (nebo jiným nepodmíněným skokem),
- 16.4: každý `switch` má `default`.

**Co za to získáte:** pravidla vás nutí odpovědět na otázku „co se stane ve všech ostatních případech?“ ve chvíli, kdy kód píšete, a ne v provozu. `switch` bez `break` je klasická chyba, `enum`, který dostane novou hodnotu, bez `default` je druhá. Složené závorky odstraňují celou rodinu chyb, kdy se pod `if` přidá druhý příkaz, který vypadá, jako by byl podmíněný:

```c
if (isError)
    Led_On();
    Buzzer_On();      /* indented like it belongs to the if - it does not */
```

A tady je switch. První verze propadne z `MODE_ON` do `MODE_ERROR` a nastaví špatnou hodnotu, druhá ošetří každý případ explicitně:

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

V mém testu gcc našel chybějící `default` i propadnutí (`-Wswitch-default -Wimplicit-fallthrough`). Pravidlo o `else` a složené závorky kontroluje analyzátor nebo formátovač.

#### Rule 17.2 - žádná rekurze (Required)

**Pravidlo:** funkce nesmí volat sama sebe, ani přímo, ani přes jiné funkce.

**Co za to získáte:** na PC má zásobník megabajty. Na mikrokontroléru máte pár kilobajtů a nejhorší případ hloubky rekurze závisí na vstupních datech. Pokud rekurzi odstraníte, maximální využití zásobníku lze *spočítat* (stačí statická analýza stromu volání) a přetečení zásobníku přestane být překvapením.

```c
uint32_t Factorial_Recursive(uint32_t value)
{
    return (value <= 1u) ? 1u : value * Factorial_Recursive(value - 1u);
}
```

Iterativní verze potřebuje konstantní množství zásobníku:

```c
uint32_t Factorial_Iterative(uint32_t value)
{
    uint32_t result = 1u;
    for (uint32_t factor = 2u; factor <= value; factor++) { result *= factor; }
    return result;
}
```

**Kdo to najde:** analyzátor a linker map (některé toolchainy vypisují graf volání, `-fstack-usage` říká velikost každého rámce).

### Pravidla o paměti a ukazatelích

#### Directive 4.12 a Rule 21.3 - žádná dynamická paměť (Required)

**Pravidlo:** nepoužívejte `malloc`, `calloc`, `realloc` a `free`.

**Co za to získáte:**

- halda se *fragmentuje*. Po týdnech běhu může selhat požadavek na 64 bajtů, přestože je volných 10 kB, jen ne v jednom kuse,
- doba provádění `malloc` není deterministická,
- únik paměti po týdnech běhu je nejhorší druh chyby k hledání,
- spotřeba paměti je známá při linkování, ne ve 3 ráno v provozu.

Standardní alternativou je pool s pevnou velikostí, který má stejný tvar API jako alokátor:

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

Funkce vrací `NULL`, jsou-li všechny rámce obsazené, takže případ „není paměť“ je v kódu ošetřen a dá se otestovat na PC. Úplně totéž se děje s `malloc`, jen to otestovat nemůžete, protože na vašem PC alokace nikdy nselže.

**Kdo to najde:** analyzátor, nebo prostě linker, který `malloc` vůbec nelinkuje.

#### Rules 11.3 a 11.5 - opatrně s přetypováním ukazatelů (Required / Advisory)

**Pravidla:** nepřetypovávejte ukazatel na objekt jednoho typu na ukazatel na objekt jiného typu (11.3) a vyhněte se konverzi z `void *` na ukazatel na objekt (11.5).

**Co za to získáte:** přetypování bajtového bufferu na `uint32_t *` je nejběžnější způsob, jak přečíst pole komunikačního rámce:

```c
uint32_t ReadU32_Bad(const uint8_t *buffer)
{
    return *(const uint32_t *)buffer;  /* misaligned access, strict aliasing violation */
}
```

Je to nedefinované chování hned dvakrát. Adresa nemusí být zarovnaná na čtyři bajty (hard fault na Cortex-M0, pomalý přístup jinde) a přístup přes ukazatel jiného typu porušuje pravidla aliasingu, takže ho optimalizátor může přeuspořádat nebo zahodit. Dvě správná řešení: `memcpy` (překladač z něj udělá jediné načtení, kde to hardware dovolí) nebo složení z bajtů, které zároveň určí pořadí bajtů a nezávisí na endianitě CPU:

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

Přetypování z `void *` je typické pro generický kontext callbacku. Je advisory, protože v C je to někdy jediná cesta. Přínos pravidla je v tom, že si všimnete každého takového místa a přetypování uděláte na jediném řádku na začátku funkce (jako v [článku o SOLID](/blog/solid-principles-c-cpp)), a ne všude.

**Kdo to najde:** každý analyzátor. Překladač přetypování najde jen na některých cílech a s `-Wcast-align`.

#### Rule 8.13 - ukazatel na const, kdykoli je to možné (Advisory)

**Pravidlo:** pokud funkce nemění data, na která ukazatel míří, ukazatel se deklaruje jako ukazatel na `const`.

**Co za to získáte:** signatura je smlouva. Volající z prototypu vidí, že funkce data jen čte, a překladač to hlídá. `const` buffer z flash lze předat jen funkci s `const`, jinak se kód nepřeloží (nebo hůř, zapíše do flash a způsobí chybu).

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

### Pravidla o kódu, který jste napsali, a kódu, který tam není

#### Rule 17.7 a Directive 4.7 - neignorujte výsledky (Required)

**Pravidla:** vrácená hodnota se musí použít (17.7) a když funkce vrací chybový kód, musí se otestovat (4.7).

**Co za to získáte:** ignorovaná návratová hodnota je ignorovaná chyba. Odeslání rámce na zaneprázdněné UART, odmítnutý zápis do flash, timeout I2C: to všechno tiše projde a aplikace pokračuje se špatným předpokladem. Pokud vás to opravdu nezajímá, řekněte to pomocí `(void)`, aby čtenář (i analyzátor) věděl, že šlo o rozhodnutí, a ne o omyl:

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

**Kdo to najde:** analyzátor, v gcc pomocí `__attribute__((warn_unused_result))` na vašem vlastním API.

#### Rules 2.1 a 2.2 - žádný nedosažitelný ani mrtvý kód (Required)

**Pravidla:** projekt nesmí obsahovat kód, který nelze nikdy provést (2.1), a kód, který se provádí, ale nemá vliv na výsledek (2.2).

**Co za to získáte:** oba druhy jsou signálem chyby: podmínka, která nikdy nenastane, zapomenutý `return` nebo chyba při copy-paste. Mrtvý kód také falšuje pokrytí testy (nedosáhnete 100 % řádků, které žádný vstup neprovede) a nutí čtenáře nad ním přemýšlet. Obojí se objevuje v této funkci:

```c
uint8_t Level_Get(uint8_t raw)
{
    uint8_t level = 3u;                /* dead: overwritten before it is read */
    level = (uint8_t)(raw / 2u);
    return level;
    Level_Log(raw);                    /* unreachable */
}
```

První přiřazení do `level` je mrtvé a poslední řádek je nedosažitelný.

**Kdo to najde:** analyzátor. gcc s `-Wall -Wextra` v mém testu mlčel.

#### Rule 20.7 a Directive 4.9 - makra s parametry (Required / Advisory)

**Pravidlo:** rozvinutý parametr makra musí být v závorkách (20.7) a funkce má přednost před makrem podobným funkci (4.9).

**Co za to získáte:** makro je textová náhrada. Pokud parametr nechráníte, rozhoduje priorita operátorů *volajícího*:

```c
#define SQUARE_BAD(x)  x * x
#define SQUARE_OK(x)   ((x) * (x))

SQUARE_BAD(2 + 1)   /* 2 + 1 * 2 + 1 = 5, not 9 */
SQUARE_OK(2 + 1)    /* ((2 + 1) * (2 + 1)) = 9 */
```

I chráněné makro má problém: `SQUARE_OK(count++)` inkrementuje dvakrát. Proto direktiva 4.9 doporučuje funkci. Inline funkce má typ, vyhodnotí argument jednou a stojí stejně:

```c
static inline uint32_t Square(uint32_t value) { return value * value; }
```

## MISRA v reálném projektu

### Varování překladače jsou první krok, ne poslední

Všechny příklady výše jsem přeložil pomocí `gcc -Wall -Wextra -Wconversion -Wshadow -Wswitch-default -Wimplicit-fallthrough -O2`. gcc ohlásil pět varování, která patří jen ke třem „špatným“ příkladům: porovnání s povýšeným doplňkem, `switch` (chybějící `default`, neošetřená hodnota enum a propadnutí) a chybějící závorky kolem `==` v testu masky. Mlčel o zúžení, neinicializované proměnné, mrtvém a nedosažitelném kódu, přetečení se znaménkem, rekurzi, přetypování ukazatele a makru.

Doporučuji jako základ překladač s maximem varování a `-Werror` v CI. Je to zadarmo a odstraní to nejviditelnější problémy, ale statickou analýzu to nenahrazuje.

### Vyberte nástroj a dejte ho do CI

Ke kontrole pravidel potřebujete statický analyzátor. Existují komerční (Polyspace, Helix QAC, PC-lint Plus, Coverity, Parasoft C/C++test, LDRA, IAR C-STAT a další) i volné, které pokrývají část pravidel, například [cppcheck](https://cppcheck.sourceforge.io/) s doplňkem pro MISRA. Doplněk potřebuje jako vstup text pravidel a kvůli autorským právům ho musíte dodat z vlastního výtisku normy. Nástroj nikdy není dokonalý: u nerozhodnutelných pravidel budete mít falešné poplachy a občas se porušení přehlédne.

Kontrola patří do CI při každém commitu, ne do ručního spuštění před vydáním. Jinak děláte stejnou práci třikrát: jednou při psaní, jednou při nalezení porušení a jednou při jeho opravě.

### Výjimky jsou součástí systému

Někdy je nutné pravidlo porušit. Přístup k hardwarovému registru potřebuje přetypování celého čísla na ukazatel, bootloader potřebuje zapisovat do flash přes ukazatel. MISRA to ví a definuje **deviation** (výjimku): záznam s pravidlem, místem, důvodem a posouzením rizika. Záznam by měl být vedle kódu:

```c
/* MISRA deviation: Rule 11.4 (Advisory), see DEV-012
 * Reason: the address of the peripheral register is fixed by the hardware.
 * Contained in this macro, the rest of the code uses the register type. */
#define UART_REGS ((uartRegisters_t *)0x40004400u)
```

Výjimka není selhání. Seznam dobře podložených výjimek je znamením projektu, ve kterém lidé přemýšlejí. Projekt s nulou výjimek a bez přístupu k hardwaru buď lže, nebo je velmi malý.

### Legacy kód a kód od dodavatelů

200 000 řádků starého projektu nezpůsobíte vyhovujícími za týden. Co funguje:

1. **Nesahejte na starý kód,** zapněte kontrolu pro *nové a změněné* soubory. Baseline analyzátoru uloží stávající porušení a CI selže jen na nových.
2. **Začněte s pravidly mandatory a required,** advisory až později.
3. **Vyjměte kód třetích stran** a zdokumentujte to. Generovaný kód dodavatele (HAL, LL, CMSIS) není vaše věc opravovat. To je další důvod pro vrstvenou architekturu z článku o [návrhu a architektuře](/blog/design-architecture): když kód dodavatele sedí v RAL a MCAL a vše nad ním je váš kód, hranicí kontroly je složka.

### Co nepomáhá

- **Hon na počet porušení.** Pravidlo opravené způsobem, který uspokojí nástroj a zničí smysl (přetypování přidané jen pro umlčení varování), je horší než původní stav.
- **Používání MISRA jako argumentu.** „MISRA to říká“ není důvod. Pokud neumíte vysvětlit, před čím vás pravidlo chrání, nebudete umět rozhodnout, kdy je čas na výjimku.
- **Víra, že vyhovění znamená správnost.** MISRA některé chyby znemožní. Požadavky, architektura, review a testy zůstávají na vás.

## Shrnutí

| Pravidlo | Stručně | Přínos |
|---|---|---|
| 9.1 | Inicializovat před čtením | Žádné náhodné hodnoty, stejné chování v debugu i release |
| 10.x | Respektovat essential types | Žádná překvapení z integer promotion a zúžení |
| Dir 4.6 | Typy pevné šířky | Stejný kód znamená totéž na každém cíli |
| 1.3 | Žádné nedefinované chování | Optimalizátor nemůže odstranit vaše kontroly |
| 14.4 | Explicitní podmínky | Záměr je čitelný |
| 12.1 | Závorky | Žádné chyby priority |
| 15.6, 15.7, 16.3, 16.4 | Složené závorky, `else`, `break`, `default` | Každý případ je ošetřen |
| 17.2 | Žádná rekurze | Využití zásobníku lze spočítat |
| Dir 4.12, 21.3 | Žádná dynamická paměť | Žádná fragmentace, úniky ani překvapení v časování |
| 11.3, 11.5 | Žádné triky s typy ukazatelů | Žádné chyby zarovnání a aliasingu |
| 8.13 | Ukazatele na `const` | Signatura je smlouva |
| 17.7, Dir 4.7 | Používat návratové hodnoty | Chyby nemizí |
| 2.1, 2.2 | Žádný nedosažitelný ani mrtvý kód | Chyby jsou vidět, pokrytí má smysl |
| 20.7, Dir 4.9 | Bezpečná makra, preferovat funkce | Žádné skryté dvojí vyhodnocení ani chyby priority |

Pokud si máte zapamatovat jedinou věc: **pravidlo MISRA je jizva po chybě, kterou už někdo měl.** Nemusíte ta pravidla mít rádi, ale je dobré vědět, po jaké chybě je každé z nich jizvou. Pak budete vědět, kdy se jím řídit a kdy napsat výjimku a převzít odpovědnost.

Zde popsaná pravidla jsou jen výběr. Celá sada má více než 140 směrnic a zbytek (preprocesor, standardní knihovna, struktura deklarací) stojí za to si jednou přečíst ve vlastním výtisku normy.
