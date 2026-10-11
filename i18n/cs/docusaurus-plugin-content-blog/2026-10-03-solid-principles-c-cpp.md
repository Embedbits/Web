---
title: "Principy SOLID: od tříd C++ k obyčejnému C"
slug: solid-principles-c-cpp
date: 2026-10-03T21:00:00
authors: [Mr.Nobody]
tags: [embedded, architecture, c, cpp]
---

Pět písmen, která se objevují při každém pracovním pohovoru ze softwarového inženýrství. S, O, L, I a D. Principy byly popsány pro objektově orientované jazyky, a tak se běžně usuzuje: „SOLID je pro C++ a Javu, my píšeme v C, takže máme hotovo.“ Ten závěr je špatný a pokusím se ukázat proč. U každého principu najdete původní myšlenku s příkladem v C++ a potom tutéž myšlenku v C, bez tříd, bez dědičnosti a bez jediného `virtual`.

<!-- truncate -->

## Odkud SOLID pochází

Principy shromáždil Robert C. Martin („Uncle Bob“) na počátku 21. století, samotnou zkratku vymyslel Michael Feathers. Některé myšlenky jsou mnohem starší: *open/closed principle* pochází od Bertranda Meyera (1988) a *Liskov substitution principle* od Barbary Liskovové (1987).

Všechny odpovídají na jednu otázku: **jak psát kód, který přežije změnu?** Ne kód, který funguje dnes, ale kód, který lze rozšiřovat, testovat a udržovat tím chlapíkem z citátu na titulní straně, který ví, kde bydlíte.

Příklady v C++ používají třídy a virtuální funkce, protože tak byly principy původně vysvětlovány. Příklady v C se řídí [mým coding stylem](/docs/platform/embi-platform/coding-style): názvy `Module_Function`, typy `_t` a proměnné se smysluplnými jmény. Jedna výjimka kvůli délce: používám prosté `uint8_t`, `uint32_t` a `float` tam, kde by skutečný projekt použil vlastní typedefy (`temperature_t`, `voltage_t`), které coding style vyžaduje. Všechny příklady v tomto článku byly přeloženy (`gcc -std=c11 -Wall -Wextra -pedantic` a `g++ -std=c++17`) a spuštěny s malým unit testem, včetně těch „špatných“.

### Co třída doopravdy je

Než začneme, krátká připomínka, co překladač dělá v zákulisí. Třída C++ s virtuálními funkcemi je:

- `struct` s daty objektu,
- skrytý ukazatel v této struktuře na tabulku ukazatelů na funkce (*vtable*), jedna tabulka na třídu,
- konvence, že každá metoda dostane ukazatel na objekt jako první parametr (`this`).

V C můžeme napsat úplně totéž ručně: `struct` s daty, `const struct` s ukazateli na funkce a `void *context` jako náhradu za `this`. Pamatujte na to, celý článek na tom stojí. C++ vám zde nedává novou schopnost, jen za vás píše šablonový kód a kontroluje ho při překladu.

## S - Single Responsibility Principle

> Modul by měl mít jeden, a jen jeden, důvod ke změně.

„Důvod ke změně“ je ta důležitá část. Neznamená „třída má jednu metodu“. Znamená, že každá část kódu odpovídá jednomu zdroji změn: když se vymění senzor, změní se jen převod, když zákazník chce jiný formát logu, změní se jen formátování.

### V C++

Následující třída dělá všechno: čte ADC, převádí hodnotu, formátuje text a odesílá ho. Čtyři důvody ke změně na jednom místě:

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

Každá změna (nový senzor, log přes CAN místo UART, jiný formát textu) upravuje tutéž třídu a nic z toho nelze otestovat bez hardwaru. Řešením je oddělit odpovědnosti a nechat monitor, aby je jen propojil:

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

Přesně stejná chyba je možná, a běžná, i v obyčejném C, kde obvykle vypadá jako jedna dlouhá funkce v `main.c`:

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

Nástrojem pro oddělení v C je **modul**: dvojice souborů `.h`/`.c` se společným prefixem, kde hlavička je veřejné rozhraní a všechno ostatní je `static`. Jeden modul, jedna odpovědnost:

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

Modul ADC (`Adc.h`) je stejná myšlenka a monitor jen propojuje moduly:

```c title="Monitor.c"
#include "Adc.h"
#include "Logger.h"
#include "Tmp36.h"

void Monitor_Run(void)
{
    Logger_Print_Temperature(Tmp36_Get_Celsius(Adc_Read()));
}
```

Pokud se TMP36 nahradí NTC, vymění se jen `Tmp36.c`. Pokud log půjde přes CAN místo UART, změní se jen `Logger.c`. A `Tmp36_Get_Celsius()` lze testovat na vašem PC obyčejným `assert`, protože se nedotýká žádného registru.

## O - Open/Closed Principle

> Softwarové entity by měly být otevřené pro rozšíření, ale uzavřené pro modifikaci.

Měli byste být schopni přidat nové chování bez úprav kódu, který už funguje a je otestovaný. Typický zápach je `switch` nad typem, který roste s každou novou funkcí.

### V C++

Níže uvedená pipeline se musí upravit pro každý nový filtr, včetně `enum` a `switch`:

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

Řešením je abstrakce (rozhraní), kterou pipeline zná a nové filtry ji implementují:

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

Nový filtr je nová třída. `SamplePipeline` je uzavřená pro modifikaci a systém je otevřený pro rozšíření.

### V C

Stejný problém se `switch` v C:

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

Náhradou virtuální tabulky v C je **tabulka ukazatelů na funkce** a `void *context` pro data instance. Abstrakce se definuje jednou:

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

Každý filtr je dvojice dat (`context`) a konstantní tabulky s chováním:

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

Druhý filtr je zcela samostatný modul, první se nedotkl:

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

Pipeline zná jen `filter_t`, takže se už nikdy nemusí měnit:

```c title="Pipeline.c"
#include "Filter.h"

float Pipeline_Feed(const filter_t *filter, float sample)
{
    return Filter_Process(filter, sample);   /* never changes again */
}
```

A takto se používá. Oba filtry pracují se stejnou pipeline:

```c
movingAverage_t average = {0};
const filter_t averageFilter = { &movingAverageOps, &average };

median3_t median = {0};
const filter_t medianFilter = { &median3Ops, &median };

float output = Pipeline_Feed(&medianFilter, sample);
```

Tabulky jsou `const`, takže žijí ve flash a nestojí žádnou RAM. To, co překladač C++ generuje pro `virtual`, je přesně tohle.

## L - Liskov Substitution Principle

> Objekty podtypu musí být použitelné všude, kde se očekává základní typ, aniž by volající poznal rozdíl.

Toto je nejméně chápaný princip. Netýká se syntaxe (tu za vás kontroluje překladač), týká se **kontraktu**. Odvozená třída nesmí vyžadovat víc, než základní třída slibuje, a nesmí dodat méně. Pokud volající potřebuje `if (typeid(...))`, princip je porušen.

### V C++

Tři paměťová zařízení za jedním rozhraním. Které z nich porušuje kontrakt?

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

`Flash` vyžaduje zarovnané adresy a délky, o čemž základní třída nikdy nemluvila, takže kód, který ukládá pět bajtů, funguje s `Eeprom` a tiše selže s `Flash`. `RomImage` vyhazuje výjimku v systému, který se pravděpodobně staví s `-fno-exceptions`. Všechny tři se přeloží a chová se správně jen jedno.

Oprava spočívá v dodržení kontraktu v implementaci a v nedědění tam, kde schopnost chybí:

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

C nemá dědičnost, takže je princip nepodstatný? Naopak, tabulka ukazatelů na funkce je rozhraní přesně jako v C++ a problém substituce je stejný. V C je to ještě nebezpečnější, protože typickými porušeními jsou `NULL` v tabulce nebo `assert` v implementaci:

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

Lék je stejný jako v C++, plus jeden zvyk: **napište kontrakt do hlavičky** a přinuťte všechny implementace, aby ho dodržovaly. Žádné `NULL` v tabulce, žádný assert pro chybu volajícího, žádná skrytá předpodmínka:

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

`Settings_Save()` funguje s flash, s obrazem ROM (dostane normální chybový kód) i s jakoukoli implementací, která přibude později.

## I - Interface Segregation Principle

> Klienti by neměli být nuceni záviset na metodách, které nepoužívají.

„Tlusté“ rozhraní svazuje každého se vším. Když UART dostane novou metodu, musí se přeložit znovu a zrevidovat každý klient a každý mock, i když chtěl jen odesílat bajty.

### V C++

Logger potřebuje jednu metodu, ale závisí na pěti:

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

Rozhraní se rozdělí podle role klienta. Konfigurace zůstane na konkrétní třídě a logger žádá jen o schopnost zapisovat bajty:

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

Mock pro test loggeru má nyní jednu metodu místo pěti.

### V C

Tlusté rozhraní existuje i v C jako obrovská struktura ukazatelů na funkce nebo, častěji, jako jeden obří hlavičkový soubor `Uart.h`, který vkládá každý:

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

Existují dva nástroje. První je stejný jako v C++: malé rozhraní (`byteSink_t`), které nese jen to, co klient potřebuje:

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

Druhý je specifický pro C: **rozdělte hlavičku**. Každý, kdo jen odesílá bajty, vkládá `Uart_Tx.h` a nikdo jiný konfiguraci nevidí:

```c
/* Uart_Config.h  - used by the code that sets the peripheral up */
void Uart_Init(uart_t *uart, uint32_t baudrate);
void Uart_Set_Parity(uart_t *uart, uartParity_t parity);

/* Uart_Tx.h      - used by everybody who only sends */
void Uart_Send(uart_t *uart, const uint8_t *data, size_t length);

/* Uart_Rx.h      - used by everybody who only receives */
size_t Uart_Receive(uart_t *uart, uint8_t *data, size_t maxLength);
```

Logger lze otestovat třířádkovou funkcí, která zachytává bajty. Neví, že UART existuje.

## D - Dependency Inversion Principle

> Moduly na vysoké úrovni by neměly záviset na modulech na nízké úrovni. Obě strany by měly záviset na abstrakcích. Abstrakce by neměly záviset na detailech.

Tento princip spojuje ostatní čtyři. Stojí za vrstvami z článku o [designu a architektuře](/blog/design-architecture): aplikace nesmí vědět, který registr přepíná LED.

### V C++

Termostat (politika na vysoké úrovni) obsahuje třídy ADC a GPIO (detaily na nízké úrovni). Nelze ho přeložit bez hardwaru, nelze ho testovat na PC a nelze ho přenést na jinou desku:

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

Po inverzi vlastní rozhraní politika a ovladače je implementují. Šipka závislosti míří k politice:

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

### In C

C nabízí dvě cesty a ta druhá je pro C jedinečná a levnější než jakékoli virtuální volání.

**1. Injekce za běhu** pomocí ukazatelů na funkce, přesně jako v příkladu open/closed. Rozhraní patří termostatu (je v `Thermostat.h`) a ovladače ho naplňují:

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

V unit testu předáte funkce, které vracejí číslo a pamatují si stav topení. Na cílové platformě předáte `Adc_Get_Celsius` a `Gpio_Set_Heater` a `Thermostat.c` zůstane nedotčen.

**2. Injekce při linkování.** Někdy nepotřebujete přepínat implementace za běhu, stačí se rozhodnout jednou, v build systému. Pak je abstrakcí **hlavička s deklaracemi** a implementací zdrojový soubor, který CMake vybere pro daný target:

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

Pro desku se linkuje `Bsp_Thermostat_Stm32.c`, který implementuje obě funkce se skutečnými periferiemi. V unit testu na PC se místo něj linkuje `Bsp_Thermostat_Fake.c`. Žádné ukazatele na funkce, žádná nepřímost, žádná RAM a termostat je stále zcela nezávislý na hardwaru. To je mimochodem přesně to, co dělá BSP Embedbits: aplikace volá rozhraní BSP a nezajímá ji, jaká rodina nebo deska je za ním.

## Stejné myšlenky ve dvou jazycích

| Princip | C++ | C |
|---|---|---|
| **S** | třída | modul (dvojice `.h`/`.c`, prefix, `static`) |
| **O** | abstraktní třída, `virtual`, `override` | `const` tabulka ukazatelů na funkce + `void *context` |
| **L** | kontrakt základní třídy | kontrakt zapsaný v hlavičce, žádné `NULL` v tabulce |
| **I** | několik malých rozhraní | malé struktury ukazatelů, rozdělené hlavičky |
| **D** | injekce rozhraní konstruktorem | ukazatele na funkce ve `struct` nebo injekce při linkování |

## Co za vás překladač neudělá

Je namístě poctivost. C++ má výhody, které musíte v C nahradit disciplínou:

- **Žádná kontrola při překladu.** Pokud se zapomene pole tabulky funkcí, překladač mlčí (designated initializers alespoň pojmenují pole a v C se chybějící stane `NULL`). Používejte inicializátory `.Process = ...`, nikdy poziční, a mějte unit test, který volá každou funkci každé implementace.
- **`void *context` není typově bezpečný.** Špatné přetypování překladač nenajde. Držte přetypování na jednom řádku na začátku každé funkce (`movingAverage_t *self = context;`) a nikde jinde.
- **Náklady.** Nepřímé volání stojí několik cyklů a tabulky stojí flash. Na Cortex-M to obvykle nevadí, ale ne v přerušení, které běží každých 10 mikrosekund. Tam je varianta při linkování zdarma.

A největší past: **SOLID je soubor doporučení, ne zákon**. Rozdělit 30řádkovou funkci na pět modulů s tabulkami ukazatelů na funkce, protože „to říká princip“, je vlastní druh špaget. Použijte princip, když existuje skutečný důvod ke změně, druhá implementace nebo unit test, který bez něj nelze napsat. Ne dřív.

Pokud si z tohoto článku zapamatujete jednu větu, ať je to tato: **principy se týkají směru závislostí a velikosti částí, ne tříd.** C++ vám dává třídy, C vám dává moduly a ukazatele na funkce. Dobrý návrh nepotřebuje ani jedno z toho, aby byl efektní.
