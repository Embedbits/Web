---
title: "Princípy SOLID: od tried v C++ po čisté C"
slug: solid-principles-c-cpp
date: 2026-10-03T21:00:00
authors: [Mr.Nobody]
tags: [embedded, architecture, c, cpp]
---

Päť písmen, ktoré sa zrejme nachádzajú v každom pracovnom pohovore v softvérovom inžinierstve. S, O, L, I a D. Princípy boli opísané pre objektovo orientované jazyky, takže bežný záver znie „SOLID je pre C++ a Javu, my píšeme v C, takže sme z obliga“. Ten záver je nesprávny a pokúsim sa ukázať prečo. Pri každom princípe nájdete pôvodnú myšlienku s príkladom v C++ a potom tú istú myšlienku v C, bez tried, bez dedičnosti a bez jediného `virtual`.

<!-- truncate -->

## Odkiaľ SOLID pochádza

Princípy zhromaždil Robert C. Martin („Uncle Bob“) na začiatku 21. storočia, samotnú skratku vymyslel Michael Feathers. Niektoré myšlienky sú oveľa staršie: *open/closed principle* pochádza od Bertranda Meyera (1988) a *Liskov substitution principle* od Barbary Liskovovej (1987).

Všetky odpovedajú na jednu otázku: **ako napísať kód, ktorý prežije zmenu?** Nie kód, ktorý funguje dnes, ale kód, ktorý sa dá rozširovať, testovať a udržiavať chlapíkom z citátu na titulnej strane, ktorý vie, kde bývate.

Príklady v C++ používajú triedy a virtuálne funkcie, pretože tak boli princípy pôvodne vysvetlené. Príklady v C sledujú [môj coding style](/docs/platform/embi-platform/coding-style): názvy `Module_Function`, typy `_t` a premenné so zmysluplnými menami. Jedna výnimka kvôli dĺžke: používam obyčajné `uint8_t`, `uint32_t` a `float` tam, kde by skutočný projekt použil vlastné typedefy (`temperature_t`, `voltage_t`), čo coding style vyžaduje. Všetky príklady v tomto článku boli skompilované (`gcc -std=c11 -Wall -Wextra -pedantic` a `g++ -std=c++17`) a spustené s malým unit testom, vrátane tých „zlých“.

### Čo je trieda v skutočnosti

Predtým, než začneme, krátka pripomienka toho, čo kompilátor robí v zákulisí. Trieda v C++ s virtuálnymi funkciami je:

- `struct` s dátami objektu,
- skrytý ukazovateľ v tejto štruktúre na tabuľku ukazovateľov na funkcie (*vtable*), jedna tabuľka na triedu,
- konvencia, že každá metóda dostane ukazovateľ na objekt ako prvý parameter (`this`).

V C môžeme presne to isté napísať ručne: `struct` s dátami, `const struct` s ukazovateľmi na funkcie a `void *context` ako náhradu za `this`. Zapamätajte si to, celý článok je na tom postavený. C++ vám tu nedáva novú schopnosť, iba za vás píše boilerplate a kontroluje ho pri kompilácii.

## S - Single Responsibility Principle

> Modul by mal mať jeden, a iba jeden, dôvod na zmenu.

Dôležitá je časť „dôvod na zmenu“. Neznamená „trieda má jednu metódu“. Znamená, že každá časť kódu zodpovedá jednému zdroju zmien: keď sa vymení senzor, zmení sa iba prepočet, keď zákazník chce iný formát logu, zmení sa iba formátovanie.

### V C++

Nasledujúca trieda robí všetko: číta ADC, prepočíta hodnotu, naformátuje text a odošle ho. Štyri dôvody na zmenu na jednom mieste:

```cpp
class TemperatureMonitor
{
public:
    void Run()
    {
        const uint16_t rawValue = AdcRead();                                // 1. hardware access
        const float celsius = (rawValue * 3.3f / 4095.0f - 0.5f) * 100.0f;  // 2. conversion
        char text[24];
        std::snprintf(text, sizeof text, "T=%.1f C\r\n", celsius);          // 3. formatting
        UartSend(text);                                                     // 4. communication
    }
};
```

Každá zmena (nový senzor, log cez CAN namiesto UART, iný formát textu) upravuje tú istú triedu a nič z toho sa nedá otestovať bez hardvéru. Oprava je oddeliť zodpovednosti a nechať monitor, aby ich iba prepájal:

```cpp
class AdcChannel
{
public:
    uint16_t Read() const { return AdcRead(); }
};

class Tmp36Converter
{
public:
    float ToCelsius(uint16_t rawValue) const
    {
        return (rawValue * 3.3f / 4095.0f - 0.5f) * 100.0f;
    }
};

class UartLogger
{
public:
    void Print(float celsius) const
    {
        char text[24];
        std::snprintf(text, sizeof text, "T=%.1f C\r\n", celsius);
        UartSend(text);
    }
};

class TemperatureMonitor
{
public:
    void Run() const { logger.Print(converter.ToCelsius(adc.Read())); }

private:
    AdcChannel   adc;
    Tmp36Converter converter;
    UartLogger   logger;
};
```

### V C

Presne tá istá chyba je možná, a bežná, aj v čistom C, kde zvyčajne vyzerá ako jedna dlhá funkcia v `main.c`:

```c
void Monitor_Run(void)
{
    const uint16_t rawValue = Adc_Read();                                // 1. hardware access
    const float celsius = (rawValue * 3.3f / 4095.0f - 0.5f) * 100.0f;  // 2. conversion
    char text[24];
    snprintf(text, sizeof text, "T=%.1f C\r\n", celsius);                // 3. formatting
    Uart_Send(text);                                                     // 4. communication
}
```

Nástrojom na oddelenie v C je **modul**: dvojica súborov `.h`/`.c` so spoločným prefixom, kde hlavička je verejné rozhranie a všetko ostatné je `static`. Jeden modul, jedna zodpovednosť:

```c title="Tmp36.h"
#ifndef TMP36_H
#define TMP36_H

/* Converts a raw ADC value of the TMP36 sensor into degrees Celsius. */
float Tmp36_Get_Celsius(uint16_t rawValue);

#endif
```
```c title="Tmp36.c"
#include "Tmp36.h"

float Tmp36_Get_Celsius(uint16_t rawValue)
{
    return (rawValue * 3.3f / 4095.0f - 0.5f) * 100.0f;
}
```
```c title="Logger.h"
#ifndef LOGGER_H
#define LOGGER_H

void Logger_Print_Temperature(float celsius);

#endif
```
```c title="Logger.c"
#include "Logger.h"

void Logger_Print_Temperature(float celsius)
{
    char text[24];
    snprintf(text, sizeof text, "T=%.1f C\r\n", celsius);
    Uart_Send(text);
}
```

Modul ADC (`Adc.h`) je rovnaká myšlienka a monitor iba prepája moduly:

```c title="Monitor.c"
#include "Adc.h"
#include "Logger.h"
#include "Tmp36.h"

void Monitor_Run(void)
{
    Logger_Print_Temperature(Tmp36_Get_Celsius(Adc_Read()));
}
```

Ak sa TMP36 nahradí NTC, vymení sa iba `Tmp36.c`. Ak log ide cez CAN namiesto UART, zmení sa iba `Logger.c`. A `Tmp36_Get_Celsius()` sa dá otestovať na vašom PC obyčajným `assert`, pretože sa nedotýka žiadneho registra.

## O - Open/Closed Principle

> Softvérové entity by mali byť otvorené na rozširovanie, ale uzavreté na modifikáciu.

Mali by ste vedieť pridať nové správanie bez úpravy kódu, ktorý už funguje a je otestovaný. Typický zápach je `switch` nad typom, ktorý rastie s každou novou funkciou.

### V C++

Pipeline nižšie sa musí upraviť pri každom novom filtri, vrátane `enum` a `switch`:

```cpp
enum class FilterType { MovingAverage, Median };

class SamplePipeline
{
public:
    explicit SamplePipeline(FilterType type) : filterType(type) {}

    float Feed(float sample)
    {
        switch (filterType)
        {
            case FilterType::MovingAverage: return MovingAverageStep(sample);
            case FilterType::Median:        return MedianStep(sample);
        }
        return sample;   // every new filter means editing this class again
    }

private:
    FilterType filterType;
    float MovingAverageStep(float sample);
    float MedianStep(float sample);
};
```

Riešením je abstrakcia (rozhranie), ktorú pipeline pozná a nové filtre ju implementujú:

```cpp
class IFilter
{
public:
    virtual ~IFilter() = default;
    virtual float Process(float sample) = 0;
};

class MovingAverage : public IFilter
{
public:
    float Process(float sample) override
    {
        sum += sample - window[index];
        window[index] = sample;
        index = (index + 1) % window.size();
        return sum / window.size();
    }

private:
    std::array<float, 4> window{};
    std::size_t index = 0;
    float sum = 0.0f;
};

class Median3 : public IFilter
{
public:
    float Process(float sample) override
    {
        last[index] = sample;
        index = (index + 1) % last.size();
        auto sorted = last;
        std::sort(sorted.begin(), sorted.end());
        return sorted[1];
    }

private:
    std::array<float, 3> last{};
    std::size_t index = 0;
};

class SamplePipeline
{
public:
    explicit SamplePipeline(IFilter& filterToUse) : filter(filterToUse) {}
    float Feed(float sample) { return filter.Process(sample); }   // never changes again

private:
    IFilter& filter;
};
```

Nový filter je nová trieda. `SamplePipeline` je uzavretá na modifikáciu a systém je otvorený na rozširovanie.

### V C

Ten istý problém so `switch` v C:

```c
typedef enum { FILTER_MOVING_AVERAGE, FILTER_MEDIAN } filterType_t;

float Pipeline_Feed(filterType_t type, float sample)
{
    switch (type)
    {
        case FILTER_MOVING_AVERAGE: return MovingAverage_Step(sample);
        case FILTER_MEDIAN:         return Median_Step(sample);
    }
    return sample;   /* every new filter means editing this function again */
}
```

Náhradou virtuálnej tabuľky v C je **tabuľka ukazovateľov na funkcie** a `void *context` pre dáta inštancie. Abstrakcia sa definuje raz:

```c title="Filter.h"
#ifndef FILTER_H
#define FILTER_H

/* The "interface": a table of functions and the data they work on. */
typedef struct
{
    float (*Process)(void *context, float sample);
}   filterOps_t;

typedef struct
{
    const filterOps_t *ops;
    void              *context;
}   filter_t;

static inline float Filter_Process(const filter_t *filter, float sample)
{
    return filter->ops->Process(filter->context, sample);
}

#endif
```

Každý filter je dvojica dát (`context`) a konštantnej tabuľky so správaním:

```c title="MovingAverage.h"
#ifndef MOVING_AVERAGE_H
#define MOVING_AVERAGE_H

#include "Filter.h"

#define MOVING_AVERAGE_SIZE 4u

typedef struct
{
    float    window[MOVING_AVERAGE_SIZE];
    float    sum;
    unsigned index;
}   movingAverage_t;

extern const filterOps_t movingAverageOps;

#endif
```
```c title="MovingAverage.c"
#include "MovingAverage.h"

static float MovingAverage_Process(void *context, float sample)
{
    movingAverage_t *self = context;

    self->sum += sample - self->window[self->index];
    self->window[self->index] = sample;
    self->index = (self->index + 1u) % MOVING_AVERAGE_SIZE;
    return self->sum / MOVING_AVERAGE_SIZE;
}

const filterOps_t movingAverageOps = { .Process = MovingAverage_Process };
```

Druhý filter je úplne samostatný modul, prvého sa nikto nedotkol:

```c title="Median3.h"
#ifndef MEDIAN3_H
#define MEDIAN3_H

#include "Filter.h"

typedef struct
{
    float    last[3];
    unsigned index;
}   median3_t;

extern const filterOps_t median3Ops;

#endif
```
```c title="Median3.c"
#include "Median3.h"

static float Median3_Process(void *context, float sample)
{
    median3_t *self = context;

    self->last[self->index] = sample;
    self->index = (self->index + 1u) % 3u;

    const float first = self->last[0], second = self->last[1], third = self->last[2];
    if ((first <= second && second <= third) || (third <= second && second <= first)) return second;
    if ((second <= first && first <= third) || (third <= first && first <= second)) return first;
    return third;
}

const filterOps_t median3Ops = { .Process = Median3_Process };
```

Pipeline pozná iba `filter_t`, takže sa už nikdy nemusí meniť:

```c title="Pipeline.c"
#include "Filter.h"

float Pipeline_Feed(const filter_t *filter, float sample)
{
    return Filter_Process(filter, sample);   /* never changes again */
}
```

A takto sa používa. Oba filtre fungujú s rovnakou pipeline:

```c
movingAverage_t average = {0};
const filter_t averageFilter = { &movingAverageOps, &average };

median3_t median = {0};
const filter_t medianFilter = { &median3Ops, &median };

float output = Pipeline_Feed(&medianFilter, sample);
```

Tabuľky sú `const`, takže žijú vo flash a nestoja žiadnu RAM. To, čo kompilátor C++ generuje pre `virtual`, je presne toto.

## L - Liskov Substitution Principle

> Objekty podtypu musia byť použiteľné všade, kde sa očakáva základný typ, bez toho, aby volajúci spozoroval rozdiel.

Toto je najmenej pochopený princíp. Nejde o syntax (tú za vás skontroluje kompilátor), ide o **kontrakt**. Odvodená trieda nesmie vyžadovať viac, než základná trieda sľubuje, a nesmie dodať menej. Ak volajúci potrebuje `if (typeid(...))`, princíp je porušený.

### V C++

Tri úložné zariadenia za jedným rozhraním. Ktoré z nich porušuje kontrakt?

```cpp
class IStorage
{
public:
    virtual ~IStorage() = default;
    virtual bool Write(uint32_t address, const uint8_t *data, std::size_t length) = 0;
};

class Eeprom : public IStorage
{
public:
    bool Write(uint32_t address, const uint8_t *data, std::size_t length) override;   // any address, any length
};

class Flash : public IStorage
{
public:
    bool Write(uint32_t address, const uint8_t *data, std::size_t length) override
    {
        if (address % 8 != 0 || length % 8 != 0)
        {
            return false;   // stronger precondition than the base class promised
        }
        return ProgramDoubleWords(address, data, length);
    }
};

class RomImage : public IStorage
{
public:
    bool Write(uint32_t, const uint8_t *, std::size_t) override
    {
        throw std::logic_error("ROM is read-only");   // the caller never expected an exception
    }
};
```

`Flash` vyžaduje zarovnané adresy a dĺžky, o čom základná trieda nikdy nehovorila, takže kód, ktorý ukladá päť bajtov, funguje s `Eeprom` a ticho zlyhá s `Flash`. `RomImage` vyhadzuje výnimku v systéme, ktorý sa pravdepodobne zostavuje s `-fno-exceptions`. Všetky tri sa skompilujú a správa sa iba jedno.

Oprava je dodržať kontrakt v implementácii a nedediť, keď schopnosť chýba:

```cpp
class IReadable
{
public:
    virtual ~IReadable() = default;
    virtual bool Read(uint32_t address, uint8_t *data, std::size_t length) = 0;
};

class IWritable : public IReadable
{
public:
    // Contract: any address, any length inside the device. Returns false only on a real failure.
    virtual bool Write(uint32_t address, const uint8_t *data, std::size_t length) = 0;
};

class Flash : public IWritable
{
public:
    bool Read(uint32_t address, uint8_t *data, std::size_t length) override;

    bool Write(uint32_t address, const uint8_t *data, std::size_t length) override
    {
        // Honours the contract: unaligned parts are merged with the current content (read-modify-write).
        return ProgramWithPadding(address, data, length);
    }
};

class RomImage : public IReadable   // cannot write, so it is not an IWritable
{
public:
    bool Read(uint32_t address, uint8_t *data, std::size_t length) override;
};
```

### V C

C nemá dedičnosť, je teda princíp irelevantný? Naopak, tabuľka ukazovateľov na funkcie je rozhranie presne ako v C++ a problém substitúcie je rovnaký. V C je to ešte nebezpečnejšie, pretože typické porušenia sú `NULL` v tabuľke alebo `assert` v implementácii:

```c
typedef struct
{
    bool (*Read)(uint32_t address, uint8_t *data, size_t length);
    bool (*Write)(uint32_t address, const uint8_t *data, size_t length);
}   storageOps_t;

static bool Flash_Write(uint32_t address, const uint8_t *data, size_t length)
{
    assert(address % 8u == 0u && length % 8u == 0u);   /* the caller was never told */
    return Flash_ProgramDoubleWords(address, data, length);
}

const storageOps_t flashStorage = { .Read = Flash_Read, .Write = Flash_Write };
const storageOps_t romStorage   = { .Read = Rom_Read,   .Write = NULL };   /* callers crash */

bool Settings_Save(const storageOps_t *storage, const uint8_t *data, size_t length)
{
    return storage->Write(SETTINGS_ADDRESS, data, length);   /* NULL call or failed assert */
}
```

Liek je rovnaký ako v C++, plus jeden zvyk: **kontrakt si zapíšte do hlavičky** a prinúťte všetky implementácie, aby ho dodržiavali. Žiadne `NULL` v tabuľke, žiadny assert pre chybu volajúceho, žiadny skrytý predpoklad:

```c title="Storage.h"
#ifndef STORAGE_H
#define STORAGE_H

#include <stdint.h>
#include <stddef.h>

typedef enum
{
    STORAGE_OK,
    STORAGE_ERROR_READ_ONLY,
    STORAGE_ERROR_RANGE,
    STORAGE_ERROR_DEVICE
}   storageStatus_t;

/*
 * Contract of every storage implementation:
 *  - Read and Write are never NULL.
 *  - Write accepts any address and any length inside the device. Alignment is the problem
 *    of the implementation, not of the caller.
 *  - Writing to a read-only device does not crash, it returns STORAGE_ERROR_READ_ONLY.
 */
typedef struct
{
    storageStatus_t (*Read)(uint32_t address, uint8_t *data, size_t length);
    storageStatus_t (*Write)(uint32_t address, const uint8_t *data, size_t length);
}   storageOps_t;

#endif
```
```c
#include "Storage.h"

static storageStatus_t Flash_Write(uint32_t address, const uint8_t *data, size_t length)
{
    /* Unaligned head and tail are merged with the current content (read-modify-write). */
    return Flash_ProgramWithPadding(address, data, length);
}

static storageStatus_t Rom_Write(uint32_t address, const uint8_t *data, size_t length)
{
    (void)address; (void)data; (void)length;
    return STORAGE_ERROR_READ_ONLY;
}

const storageOps_t flashStorage = { .Read = Flash_Read, .Write = Flash_Write };
const storageOps_t romStorage   = { .Read = Rom_Read,   .Write = Rom_Write   };

storageStatus_t Settings_Save(const storageOps_t *storage, const uint8_t *data, size_t length)
{
    return storage->Write(SETTINGS_ADDRESS, data, length);   /* works with every implementation */
}
```

`Settings_Save()` funguje s flash, s obrazom ROM (dostane normálny chybový kód) aj s každou implementáciou, ktorá sa objaví neskôr.

## I - Interface Segregation Principle

> Klienti by nemali byť nútení závisieť od metód, ktoré nepoužívajú.

„Tučné“ rozhranie viaže každého na všetko. Keď UART dostane novú metódu, musí sa prekompilovať a skontrolovať každý klient a každý mock, hoci chceli iba posielať bajty.

### V C++

Logger potrebuje jednu metódu, ale závisí od piatich:

```cpp
class IUart
{
public:
    virtual ~IUart() = default;
    virtual void        Init(uint32_t baudrate) = 0;
    virtual void        SetParity(Parity parity) = 0;
    virtual void        EnableDma(bool enable) = 0;
    virtual void        Send(const uint8_t *data, std::size_t length) = 0;
    virtual std::size_t Receive(uint8_t *data, std::size_t maxLength) = 0;
};

class Logger
{
public:
    explicit Logger(IUart& uartToUse) : uart(uartToUse) {}   // needs one method, depends on five
    void Print(const char *text) { uart.Send(reinterpret_cast<const uint8_t *>(text), std::strlen(text)); }

private:
    IUart& uart;
};
```

Rozhranie sa rozdelí podľa úlohy klienta. Konfigurácia ostáva na konkrétnej triede a logger žiada iba schopnosť zapisovať bajty:

```cpp
class IByteSink
{
public:
    virtual ~IByteSink() = default;
    virtual void Write(const uint8_t *data, std::size_t length) = 0;
};

class IByteSource
{
public:
    virtual ~IByteSource() = default;
    virtual std::size_t Read(uint8_t *data, std::size_t maxLength) = 0;
};

class Uart : public IByteSink, public IByteSource
{
public:
    void Init(uint32_t baudrate);          // configuration stays on the concrete class
    void SetParity(Parity parity);
    void EnableDma(bool enable);
    void Write(const uint8_t *data, std::size_t length) override;
    std::size_t Read(uint8_t *data, std::size_t maxLength) override;
};

class Logger
{
public:
    explicit Logger(IByteSink& sinkToUse) : sink(sinkToUse) {}   // exactly what it needs
    void Print(const char *text) { sink.Write(reinterpret_cast<const uint8_t *>(text), std::strlen(text)); }

private:
    IByteSink& sink;
};
```

Mock pre test loggeru má teraz jednu metódu namiesto piatich.

### V C

Tučné rozhranie existuje aj v C, ako obrovská štruktúra ukazovateľov na funkcie alebo, častejšie, ako jeden gigantický hlavičkový súbor `Uart.h`, ktorý includuje každý:

```c
typedef struct
{
    void   (*Init)(uint32_t baudrate);
    void   (*SetParity)(uartParity_t parity);
    void   (*EnableDma)(bool enable);
    void   (*Send)(const uint8_t *data, size_t length);
    size_t (*Receive)(uint8_t *data, size_t maxLength);
}   uartDriver_t;

void Log_Init(const uartDriver_t *uart);   /* needs Send, receives five functions */
```

Existujú dva nástroje. Prvý je rovnaký ako v C++: malé rozhranie (`byteSink_t`), ktoré nesie iba to, čo klient potrebuje:

```c title="ByteSink.h"
#ifndef BYTE_SINK_H
#define BYTE_SINK_H

#include <stddef.h>
#include <stdint.h>

typedef struct
{
    void (*Write)(void *context, const uint8_t *data, size_t length);
    void  *context;
}   byteSink_t;

#endif
```
```c title="Log.h"
#ifndef LOG_H
#define LOG_H

#include "ByteSink.h"

void Log_Init(const byteSink_t *sink);
void Log_Print(const char *text);

#endif
```
```c title="Log.c"
#include "Log.h"
#include <string.h>

static const byteSink_t *logSink;

void Log_Init(const byteSink_t *sink)
{
    logSink = sink;
}

void Log_Print(const char *text)
{
    logSink->Write(logSink->context, (const uint8_t *)text, strlen(text));
}
```

Druhý je špecifický pre C: **rozdeľte hlavičku**. Každý, kto iba posiela bajty, includuje `Uart_Tx.h` a nikto iný nevidí konfiguráciu:

```c
/* Uart_Config.h  - used by the code that sets the peripheral up */
void Uart_Init(uart_t *uart, uint32_t baudrate);
void Uart_Set_Parity(uart_t *uart, uartParity_t parity);

/* Uart_Tx.h      - used by everybody who only sends */
void Uart_Send(uart_t *uart, const uint8_t *data, size_t length);

/* Uart_Rx.h      - used by everybody who only receives */
size_t Uart_Receive(uart_t *uart, uint8_t *data, size_t maxLength);
```

Logger sa dá otestovať trojriadkovou funkciou, ktorá zachytáva bajty. Nevie, že UART existuje.

## D - Dependency Inversion Principle

> Moduly vyššej úrovne by nemali závisieť od modulov nižšej úrovne. Obe by mali závisieť od abstrakcií. Abstrakcie by nemali závisieť od detailov.

Toto je princíp, ktorý spája ostatné štyri. Stojí za vrstvami z článku o [dizajne a architektúre](/blog/design-architecture): aplikácia nesmie vedieť, ktorý register prepína LED.

### V C++

Termostat (politika vysokej úrovne) obsahuje triedy ADC a GPIO (detaily nízkej úrovne). Nedá sa skompilovať bez hardvéru, nedá sa testovať na PC a nedá sa preniesť na inú dosku:

```cpp
class Thermostat
{
public:
    void Update()
    {
        const float celsius = adcSensor.ReadCelsius();   // knows the ADC
        if (celsius < 20.0f) { gpioHeater.On(); }        // knows the GPIO pin
        else if (celsius > 22.0f) { gpioHeater.Off(); }
    }

private:
    AdcSensor  adcSensor;     // concrete low-level classes inside a high-level policy
    GpioHeater gpioHeater;
};
```

Po inverzii vlastní politika rozhrania a ovládače ich implementujú. Šípka závislosti ukazuje na politiku:

```text
before:   Thermostat ───▶ AdcSensor, GpioHeater

after:    Thermostat ───▶ ITemperatureSensor, IHeater
                                ▲                ▲
                                │                │
                          AdcSensor         GpioHeater   (or a fake in the test)
```

```cpp
class ITemperatureSensor
{
public:
    virtual ~ITemperatureSensor() = default;
    virtual float ReadCelsius() = 0;
};

class IHeater
{
public:
    virtual ~IHeater() = default;
    virtual void Set(bool on) = 0;
};

class Thermostat   // high-level policy: knows only the abstractions
{
public:
    Thermostat(ITemperatureSensor& sensorToUse, IHeater& heaterToUse)
        : sensor(sensorToUse), heater(heaterToUse) {}

    void Update()
    {
        const float celsius = sensor.ReadCelsius();
        if (celsius < 20.0f)      { heater.Set(true);  }
        else if (celsius > 22.0f) { heater.Set(false); }
    }

private:
    ITemperatureSensor& sensor;
    IHeater&            heater;
};

class AdcSensor  : public ITemperatureSensor { public: float ReadCelsius() override; };
class GpioHeater : public IHeater            { public: void  Set(bool on) override; };
```

### V C

C ponúka dva spôsoby a ten druhý je jedinečný pre C a lacnejší než akékoľvek virtuálne volanie.

**1. Injektovanie za behu** pomocou ukazovateľov na funkcie, presne ako v príklade open/closed. Rozhranie patrí termostatu (je v `Thermostat.h`), ovládače ho vypĺňajú:

```c title="Thermostat.h"
#ifndef THERMOSTAT_H
#define THERMOSTAT_H

#include <stdbool.h>

/* The thermostat owns the interface, the drivers implement it. */
typedef struct
{
    float (*Get_Celsius)(void *context);
    void  (*Set_Heater)(void *context, bool on);
    void   *context;
}   thermostatPorts_t;

void Thermostat_Update(const thermostatPorts_t *ports);

#endif
```
```c title="Thermostat.c"
#include "Thermostat.h"

void Thermostat_Update(const thermostatPorts_t *ports)
{
    const float celsius = ports->Get_Celsius(ports->context);

    if (celsius < 20.0f)      { ports->Set_Heater(ports->context, true);  }
    else if (celsius > 22.0f) { ports->Set_Heater(ports->context, false); }
}
```

V unit teste odovzdáte funkcie, ktoré vrátia číslo a zapamätajú si stav ohrievača. Na cieľovom zariadení odovzdáte `Adc_Get_Celsius` a `Gpio_Set_Heater` a `Thermostat.c` zostane nedotknutý.

**2. Injektovanie pri linkovaní.** Niekedy nepotrebujete prepínať implementácie za behu, stačí urobiť rozhodnutie raz, v build systéme. Potom je abstrakciou **hlavička s deklaráciami** a implementáciou zdrojový súbor, ktorý CMake vyberie pre cieľ:

```c title="Bsp_Thermostat.h"
#ifndef BSP_THERMOSTAT_H
#define BSP_THERMOSTAT_H

#include <stdbool.h>

/* Implemented by the BSP of the board - or by a fake in the unit test. */
float Bsp_Get_Celsius(void);
void  Bsp_Set_Heater(bool on);

#endif
```
```c title="ThermostatLink.c"
#include "Bsp_Thermostat.h"

void Thermostat_Update(void)
{
    const float celsius = Bsp_Get_Celsius();

    if (celsius < 20.0f)      { Bsp_Set_Heater(true);  }
    else if (celsius > 22.0f) { Bsp_Set_Heater(false); }
}
```

Pre dosku sa zlinkuje `Bsp_Thermostat_Stm32.c`, ktorý implementuje obe funkcie so skutočnými perifériami. V unit teste na PC sa namiesto toho zlinkuje `Bsp_Thermostat_Fake.c`. Žiadne ukazovatele na funkcie, žiadna nepriama adresácia, žiadna RAM a termostat je stále úplne nezávislý od hardvéru. Mimochodom, presne toto robí BSP Embedbits: aplikácia volá rozhranie BSP a je jej jedno, aká rodina alebo doska je za ním.

## Tie isté myšlienky v dvoch jazykoch

| Princíp | C++ | C |
|---|---|---|
| **S** | trieda | modul (dvojica `.h`/`.c`, prefix, `static`) |
| **O** | abstraktná trieda, `virtual`, `override` | `const` tabuľka ukazovateľov na funkcie + `void *context` |
| **L** | kontrakt základnej triedy | kontrakt zapísaný v hlavičke, žiadne `NULL` v tabuľke |
| **I** | niekoľko malých rozhraní | malé štruktúry ukazovateľov, rozdelené hlavičky |
| **D** | konštruktorové injektovanie rozhrania | ukazovatele na funkcie v `struct` alebo injektovanie pri linkovaní |

## Čo kompilátor za vás neurobí

Treba byť úprimný. C++ má výhody, ktoré musíte v C nahradiť disciplínou:

- **Žiadna kontrola pri kompilácii.** Ak sa zabudne pole tabuľky funkcií, kompilátor mlčí (designated initializers aspoň pomenúvajú polia a v C sa chýbajúce stane `NULL`). Používajte inicializátory `.Process = ...`, nikdy poziciové, a majte unit test, ktorý volá každú funkciu každej implementácie.
- **`void *context` nie je typovo bezpečný.** Zlé pretypovanie kompilátor nenájde. Držte pretypovanie v jednom riadku na začiatku každej funkcie (`movingAverage_t *self = context;`) a nikde inde.
- **Náklady.** Nepriame volanie je pár cyklov a tabuľky stoja flash. Na Cortex-M to zvyčajne nevadí, ale nie v prerušení, ktoré beží každých 10 mikrosekúnd. Tam je variant pri linkovaní zadarmo.

A najväčšia pasca: **SOLID je súbor odporúčaní, nie zákon**. Rozdeliť 30-riadkovú funkciu na päť modulov s tabuľkami ukazovateľov na funkcie, lebo „to hovorí princíp“, je vlastný druh špagetového kódu. Uplatnite princíp, keď existuje skutočný dôvod na zmenu, druhá implementácia alebo unit test, ktorý sa bez neho nedá napísať. Nie skôr.

Ak si z tohto článku zapamätáte jednu vetu, nech je to táto: **princípy sú o smere závislostí a veľkosti kúskov, nie o triedach.** C++ vám dáva triedy, C vám dáva moduly a ukazovatele na funkcie. Dobrý dizajn nepotrebuje ani jedno z nich, aby bol efektný.
