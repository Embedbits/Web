---
title: "Přerušení a main(): jak bezpečně sdílet data"
slug: interrupts-and-main-shared-data
date: 2026-10-06T14:00:00
authors: [Mr.Nobody]
tags: [embedded, c, stm32]
---

Obsluha přerušení a hlavní smyčka jsou dva programy, které běží ve stejné paměti a o sobě nevědí. Překladač C neví, že přerušení existuje, a CPU neví, že dvě proměnné patří k sobě. Ví to jen programátor a chyby, které z toho vznikají, jsou ty nejhorší: objeví se jednou za tisíc běhů, zmizí, když připojíte debugger, a při code review se nikdy neukážou, protože kód vypadá správně.

Tento článek prochází tři problémy sdílených dat, jeden po druhém, s kódem, který **selhává**, a potom ukazuje vzory, které fungují. Experimenty běží na Cortex-M4 (v QEMU, na modelu desky s STM32F4) nebo na PC a výstupy jsou skutečné.

<!-- truncate -->

## Problém 1: překladač přerušení nevidí

Nejjednodušší komunikace mezi přerušením a hlavní smyčkou je příznak (flag). Přerušení ho nastaví, hlavní smyčka na něj čeká:

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

To je celý program a s optimalizací `-O2` **nikdy neskončí**. Spustil jsem ho v QEMU s SysTick jako zdrojem přerušení (přerušení se spustí a nastaví příznak) a porovnal verzi s `volatile` a bez něj:

```text
--- without volatile
(no output, the program was killed by the timeout after 5 s)
--- with volatile
the interrupt was seen
```

Proč? Podívejte se, co překladač vygeneroval pro smyčku v první verzi:

```text
 8000062:  ldrb  r3, [r1, #0]       @ read the flag once
 8000064:  cbnz  r3, 8000068        @ non-zero: leave the loop
 8000066:  b.n   8000066            @ zero: jump to itself, forever
```

Překladač uvažuje jen o kódu `main()` a v tom kódu do `dataReady` nikdo nezapisuje. Hodnota se tedy nemůže změnit, stačí ji přečíst jednou a smyčka se stane nekonečnou. Přesně to, oč jste z jeho pohledu požádali. S `volatile` musí překladač číst proměnnou z paměti při každém průchodu:

```text
 8000062:  ldrb  r3, [r2, #0]       @ read the flag in every pass
 8000064:  cmp   r3, #0
 8000066:  beq.n 8000062
```

Poučení: **každá proměnná sdílená mezi přerušením a hlavním kódem musí být `volatile`.** Totéž platí pro každý registr periferie, což je důvod, proč jsou definice registrů v hlavičkách CMSIS `volatile`. Mějte na paměti, že bez toho to v debug buildu (`-O0`) funguje a v release buildu selže, a proto se chyba najde pozdě.

## Problém 2: `volatile` nezaručuje atomicitu

`volatile` říká „čti a zapisuj paměť pokaždé“. Neříká „všechno najednou“. Nevinný řádek `counter++` jsou tři instrukce:

```text
Increment_Plain:
   ldr   r2, [pc, #8]       @ address of the counter
   ldr   r3, [r2, #0]       @ 1. load the value
   adds  r3, #1             @ 2. add one
   str   r3, [r2, #0]       @ 3. store it back
```

Pokud přerušení přijde mezi načtením a uložením a přerušení také inkrementuje čítač, jedna ze dvou inkrementací se **ztratí**: hlavní kód uloží starou hodnotu plus jedna přes hodnotu, kterou právě uložilo přerušení. Časová osa:

| Krok | Hlavní kód | Přerušení | Čítač |
|---|---|---|---|
| 1 | načte 5 | | 5 |
| 2 | | načte 5, přičte 1, uloží 6 | 6 |
| 3 | přičte 1 (v registru má 5) | | 6 |
| 4 | uloží 6 | | **6, mělo být 7** |

Chtěl jsem to ukázat i na Cortex-M4 a nevyšlo to: ve 200 000 inkrementacích s přerušením každých pár instrukcí QEMU nic neztratilo. Pravděpodobně proto, že QEMU kontroluje přerušení mezi bloky přeloženého kódu, takže žádné nikdy nepřistane mezi `ldr` a `str`. Je to užitečná připomínka, že **simulátor neprokazuje nepřítomnost race condition**: skutečné MCU může přerušit po každé instrukci. Stejný race, na místě, kde se snadno reprodukuje, jsou dvě vlákna na PC:

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

Třetina všech inkrementací se ztratí a výsledky se běh od běhu liší. Vlákno na PC a přerušení na MCU jsou v tomto ohledu totéž: druhý tok řízení, který může udeřit mezi dvěma instrukcemi. Totéž platí pro všechno, co je větší než slovo CPU: 64bitové časové razítko nebo struktura se dvěma poli se může přečíst napůl staré a napůl nové (*torn read*).

## Tři způsoby řešení

### 1. Jeden zapisovatel pro každou proměnnou (nejlepší)

Nejrobustnější řešení je navrhnout data tak, aby **každou proměnnou zapisovala jen jedna strana**. Přerušení zapisuje příznak, hlavní kód ho jen čte a nemaže (nebo naopak). Bez dvou zapisovatelů není co ztratit. Pokud obě strany potřebují měnit tutéž věc, neměly by ji sdílet: každá má vlastní proměnnou (čítač přerušení je `isrCalls`, čítač hlavního kódu je jiný) a součet vytvoří čtenář.

### 2. Kritická sekce

Když se dvěma zapisovatelům nelze vyhnout, přerušení se na dobu operace zakážou. Správný způsob je **uložit stav a obnovit ho**, a ne na konci slepě přerušení povolit, protože funkce mohla být zavolána s již zakázanými přerušeními:

```text
Increment_CriticalSection:
   mrs   r1, PRIMASK        @ save the state of the mask
   cpsid i                  @ disable the interrupts
   ldr   r3, [r2, #0]
   adds  r3, #1
   str   r3, [r2, #0]
   msr   PRIMASK, r1        @ restore the state, as it was
```

Cenou je latence: během sekce nemůže běžet žádné přerušení. Sekce proto musí být krátká jako pár instrukcí a bez volání funkce, smyčky nebo čekání uvnitř.

### 3. Atomická operace

Pro jediné slovo (čítač, příznak s počtem) má procesor instrukce `LDREX` a `STREX`: uložení uspěje, jen pokud se adresy od načtení nic nedotklo, a když ne, smyčka se opakuje. Překladač je za vás vygeneruje ze standardní operace:

```text
Increment_Atomic:
   ldrex r1, [r3]           @ load and mark the address
   adds  r1, #1
   strex r2, r1, [r3]       @ store only if nobody has touched it, r2 = 0 on success
   cmp   r2, #0
   bne.n Increment_Atomic   @ somebody did: try again
```

v C je to jeden řádek, `__atomic_fetch_add(&counter, 1u, __ATOMIC_RELAXED)` (nebo `atomic_fetch_add()` z `<stdatomic.h>`). Nezakazuje přerušení, takže nepřidává latenci. Funguje pro jedinou proměnnou; pro dvě proměnné, které patří k sobě, nepomůže.

## Nejpoužívanější vzor: kruhový buffer

Nejčastější věc, kterou přerušení předává hlavnímu kódu, je proud dat: bajty přijaté UARTem, vzorky ADC. Přerušení je nemůže zpracovat (musí být krátké), a tak je vloží do **fronty** a hlavní kód je vybere v klidné chvíli. Je to problém producent-konzument s *jedním producentem* (přerušení) a *jedním konzumentem* (hlavní kód) a právě pro tento případ kruhový buffer **nepotřebuje žádný zámek**:

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

Proč je správný?

- `head` zapisuje **jen producent** a `tail` **jen konzument**. Neexistuje proměnná se dvěma zapisovateli, takže se nemůže ztratit žádná aktualizace: je to první řešení výše, zabudované do struktury.
- Čítače jsou volně běžící (nikdy se neresetují). Počet položek je `head - tail` a díky aritmetice bez znaménka je správný i po přetečení čítačů. Při velikosti, která je mocninou dvou, je pozice jednoduchá maska místo dělení.
- Záleží na **pořadí**: producent zapíše položku a **teprve potom** ji zveřejní posunutím `head` (`memory_order_release`) a konzument čte nejprve `head` (`memory_order_acquire`) a až potom položku. Na jednom jádru Cortex-M záleží jen na pořadí, v jakém překladač zapisuje, a atomiky ho zachovávají. Na MCU se dvěma jádry (některé STM32H7 mají dvě) nebo s cache je stejný kód stále správný, a to je důvod, proč ho psát v této podobě a ne s `volatile`, které náhodou funguje.
- Producent nečeká. Plný buffer znamená „zahoď položku a započítej to“, protože přerušení nemůže na nikoho čekat. Čítač zahozených položek vám v testu řekne, že buffer je příliš malý.

Otestoval jsem ho dvěma způsoby. Na PC se dvěma vlákny, producentem a konzumentem, projde 20 milionů položek bufferem o 16 slotech:

```text
items 20000000, order errors 0
```

a na Cortex-M4 v QEMU: přerušení SysTick je producent a `main()` konzument, s 5000 položkami:

```text
items received  5000
order errors    0
full buffer hits 0
```

První test je těžší (obě vlákna skutečně běží paralelně na dvou jádrech), druhý je skutečná situace MCU. Je to také ideální kandidát na unit test na PC, jako v článku o [unit testování s Unity a CMock](/blog/unit-testing-unity-cmock): modul je nezávislý na hardwaru.

## Pravidla pro obsluhu přerušení

1. **Krátká.** Přečíst registr, uložit data, nastavit příznak, vymazat pending flag, vrátit se. Zpracování se dělá v hlavním kódu.
2. **Žádné čekání, žádná alokace, žádný `printf`.** Nic, co blokuje, trvá dlouho nebo volá funkci, která není bezpečná pro volání z přerušení (je *non-reentrant*, pokud uvnitř používá statický buffer).
3. **Vše sdílené je `volatile` nebo atomické** a každá proměnná má definovaného zapisovatele.
4. **Nesdílejte víc, než musíte.** Příznak nebo fronta mezi stranami, ne struktura o deseti polích.
5. **Myslete na prioritu.** Přerušení s vyšší prioritou může přerušit jiné přerušení. Proměnná sdílená mezi dvěma přerušeními má stejný problém jako ta sdílená s hlavním kódem.

V BSP Embedbits mají periferní moduly (např. USART) variantu zpracování dat s pollingem, s přerušením a s DMA a varianta s přerušením je přesně tohle: handler na úrovni MCAL, který vezme data z periferie a předá je aplikaci přes buffer, zatímco `Task` modulu běží v hlavní smyčce a provádí zpracování.

## Shrnutí

| Problém | Příznak | Lék |
|---|---|---|
| Překladač nevidí přerušení | Funguje s `-O0`, nekonečná smyčka s `-O2` | `volatile` na každé sdílené proměnné |
| `counter++` není atomické | Počet, který je občas příliš malý | Jeden zapisovatel na proměnnou, kritická sekce nebo `atomic_fetch_add` |
| Více než slovo | Napůl stará, napůl nová hodnota | Kritická sekce, sekvenční číslo nebo fronta |
| Proud dat | Ztracené nebo promíchané bajty | Kruhový buffer s jedním producentem a jedním konzumentem |
| Test projde v simulátoru | Chyba v terénu | Pamatujte, že simulátor přerušuje na jiných místech než MCU |

Tři druhy kódu v tomto článku měly jedno společné: všechny *vypadaly* správně.
