---
title: "SOLID principles: from C++ classes to plain C"
slug: solid-principles-c-cpp
date: 2026-10-03T21:00:00
authors: [Mr.Nobody]
tags: [embedded, architecture, c, cpp]
---

Five letters that every job interview in software engineering seems to contain. S, O, L, I and D. The principles were described for object oriented languages, so the common conclusion is "SOLID is for C++ and Java, we write C, so we are done". That conclusion is wrong, and I will try to show why. For every principle you will find the original idea with a C++ example, and then the same idea in C, without classes, without inheritance and without a single `virtual`.

<!-- truncate -->

## Where SOLID comes from

The principles were collected by Robert C. Martin ("Uncle Bob") in the early 2000s, the acronym itself was coined by Michael Feathers. Some of the ideas are much older: the *open/closed principle* comes from Bertrand Meyer (1988) and the *Liskov substitution principle* from Barbara Liskov (1987).

All of them answer one question: **how do I write code that survives change?** Not code that works today, but code that can be extended, tested and maintained by the guy from the quote on the front page, who knows where you live.

The C++ examples use classes and virtual functions because that is how the principles were originally explained. The C examples follow [my coding style](/docs/platform/embi-platform/coding-style): `Module_Function` names, `_t` types and variables with meaningful names. All examples in this article were compiled (`gcc -std=c11 -Wall -Wextra -pedantic` and `g++ -std=c++17`) and run with a small unit test, including the "bad" ones.

### What a class really is

Before we start, a short reminder of what the compiler does behind the scenes. A C++ class with virtual functions is:

- a `struct` with the data of the object,
- a hidden pointer in this struct to a table of function pointers (the *vtable*), one table per class,
- a convention that every method gets the pointer to the object as the first parameter (`this`).

In C we can write exactly the same thing by hand: a `struct` with data, a `const struct` with function pointers, and a `void *context` as the replacement for `this`. Keep this in mind, the whole article is built on it. C++ does not give you a new ability here, it only writes the boilerplate for you and checks it at compile time.

## S - Single Responsibility Principle

> A module should have one, and only one, reason to change.

The "reason to change" is the important part. It does not mean "a class has one method". It means that each part of the code answers to one source of changes: when the sensor is replaced, only the conversion changes, when the customer wants another log format, only the formatting changes.

### In C++

The following class does everything: it reads the ADC, converts the value, formats the text and sends it. Four reasons to change in one place:

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

Every change (a new sensor, a CAN log instead of UART, a different text format) edits the same class, and nothing of it can be tested without the hardware. The fix is to separate the responsibilities and let the monitor only connect them:

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

### In C

Exactly the same mistake is possible, and common, in plain C, where it usually looks like one long function in `main.c`:

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

The tool for separation in C is the **module**: a pair of files `.h`/`.c` with a common prefix, where the header is the public interface and everything else is `static`. One module, one responsibility:

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

The ADC module (`Adc.h`) is the same idea and the monitor only wires the modules together:

```c title="Monitor.c"
#include "Adc.h"
#include "Logger.h"
#include "Tmp36.h"

void Monitor_Run(void)
{
    Logger_Print_Temperature(Tmp36_Get_Celsius(Adc_Read()));
}
```

If the TMP36 is replaced by an NTC, only `Tmp36.c` is exchanged. If the log goes to CAN instead of UART, only `Logger.c` changes. And `Tmp36_Get_Celsius()` can be tested on your PC with a plain `assert`, because it does not touch any register.

## O - Open/Closed Principle

> Software entities should be open for extension, but closed for modification.

You shall be able to add new behaviour without editing code that already works and is tested. The typical smell is a `switch` over a type that grows with every new feature.

### In C++

The pipeline below has to be modified for every new filter, including the `enum` and the `switch`:

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

The solution is an abstraction (interface) that the pipeline knows and new filters implement:

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

A new filter is a new class. `SamplePipeline` is closed for modification and the system is open for extension.

### In C

The same `switch` problem in C:

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

The C replacement for the virtual table is a **table of function pointers** and a `void *context` for the data of the instance. The abstraction is defined once:

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

Every filter is a pair of the data (`context`) and a constant table with the behaviour:

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

The second filter is a completely separate module, the first one was not touched:

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

The pipeline knows only `filter_t`, so it never needs to change again:

```c title="Pipeline.c"
#include "Filter.h"

float Pipeline_Feed(const filter_t *filter, float sample)
{
    return Filter_Process(filter, sample);   /* never changes again */
}
```

And this is how it is used. Both filters work with the same pipeline:

```c
movingAverage_t average = {0};
const filter_t averageFilter = { &movingAverageOps, &average };

median3_t median = {0};
const filter_t medianFilter = { &median3Ops, &median };

float output = Pipeline_Feed(&medianFilter, sample);
```

The tables are `const`, so they live in flash and cost no RAM. What the C++ compiler generates for `virtual` is exactly this.

## L - Liskov Substitution Principle

> Objects of a subtype must be usable wherever the base type is expected, without the caller noticing the difference.

This is the least understood principle. It is not about the syntax (the compiler checks that for you), it is about the **contract**. A derived class must not require more than the base class promises and must not deliver less. If the caller needs an `if (typeid(...))`, the principle is broken.

### In C++

Three storage devices behind one interface. Which of them violates the contract?

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

`Flash` requires aligned addresses and lengths, which the base class never mentioned, so code that stores five bytes works with `Eeprom` and silently fails with `Flash`. `RomImage` throws an exception in a system that probably builds with `-fno-exceptions`. All three compile, and only one behaves.

The fix is to honour the contract in the implementation, and to not inherit when the capability is not there:

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

### In C

C has no inheritance, so is the principle irrelevant? On the contrary, a table of function pointers is an interface exactly like in C++ and the substitution problem is the same. In C it is even more dangerous, because the typical violations are a `NULL` in the table or an `assert` in the implementation:

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

The cure is the same as in C++, plus one habit: **write the contract down in the header** and make all implementations obey it. No `NULL` in the table, no assert for a caller's mistake, no hidden precondition:

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

`Settings_Save()` works with the flash, the ROM image (it gets a normal error code) and with any implementation that appears later.

## I - Interface Segregation Principle

> Clients should not be forced to depend on methods they do not use.

A "fat" interface couples everyone to everything. When the UART gets a new method, every client and every mock has to be recompiled and reviewed, even though they only wanted to send bytes.

### In C++

The logger needs one method, but depends on five:

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

The interface is split by the role of the client. Configuration stays on the concrete class, and the logger asks only for the ability to write bytes:

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

A mock for the logger test has now one method instead of five.

### In C

The fat interface exists in C as a huge struct of function pointers or, more often, as one giant header file `Uart.h` that everybody includes:

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

There are two tools. The first is the same as in C++: a small interface (`byteSink_t`) that carries only what the client needs:

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

The second one is specific for C: **split the header**. Everyone who only sends bytes includes `Uart_Tx.h` and nobody else sees the configuration:

```c
/* Uart_Config.h  - used by the code that sets the peripheral up */
void Uart_Init(uart_t *uart, uint32_t baudrate);
void Uart_Set_Parity(uart_t *uart, uartParity_t parity);

/* Uart_Tx.h      - used by everybody who only sends */
void Uart_Send(uart_t *uart, const uint8_t *data, size_t length);

/* Uart_Rx.h      - used by everybody who only receives */
size_t Uart_Receive(uart_t *uart, uint8_t *data, size_t maxLength);
```

The logger can be tested with a three-line function that captures the bytes. It does not know that a UART exists.

## D - Dependency Inversion Principle

> High-level modules should not depend on low-level modules. Both should depend on abstractions. Abstractions should not depend on details.

This is the principle that connects the other four. It is the one behind the layers from the article about [architecture design](/docs/architecture-design): the application must not know which register toggles a LED.

### In C++

The thermostat (a high-level policy) contains the ADC and GPIO classes (low-level details). It cannot be compiled without the hardware, cannot be tested on a PC and cannot be moved to another board:

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

After the inversion, the policy owns the interfaces and the drivers implement them. The arrow of the dependency points to the policy:

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

C offers two ways, and the second one is unique for C and cheaper than any virtual call.

**1. Runtime injection** with function pointers, exactly like in the open/closed example. The interface belongs to the thermostat (it is in `Thermostat.h`), the drivers fill it:

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

In the unit test you pass functions that return a number and remember the heater state. On the target you pass `Adc_Get_Celsius` and `Gpio_Set_Heater`, and `Thermostat.c` stays untouched.

**2. Link-time injection.** Sometimes you do not need to switch implementations at runtime, you only need to make a decision once, in the build system. Then the abstraction is a **header with declarations** and the implementation is a source file that CMake picks for the target:

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

For the board, `Bsp_Thermostat_Stm32.c` is linked and implements both functions with the real peripherals. In the unit test on the PC, `Bsp_Thermostat_Fake.c` is linked instead. No function pointers, no indirection, no RAM, and the thermostat is still completely independent of the hardware. This is, by the way, exactly what the BSP of Embedbits does: the application calls an interface of the BSP and does not care which family or which board is behind it.

## The same ideas in two languages

| Principle | C++ | C |
|---|---|---|
| **S** | class | module (`.h`/`.c` pair, prefix, `static`) |
| **O** | abstract class, `virtual`, `override` | `const` table of function pointers + `void *context` |
| **L** | contract of the base class | contract written in the header, no `NULL` in the table |
| **I** | several small interfaces | small structs of pointers, split headers |
| **D** | constructor injection of an interface | function pointers in a `struct`, or link-time injection |

## What the compiler does not do for you

Honesty is due. C++ has advantages that you have to replace by discipline in C:

- **No compile-time check.** If a field of the function table is forgotten, the compiler stays silent (designated initializers at least name the fields, and in C a missing one becomes `NULL`). Use `.Process = ...` initializers, never positional ones, and have a unit test that calls every function of each implementation.
- **`void *context` is not type safe.** A wrong cast will not be found by the compiler. Keep the cast in one line at the beginning of each function (`movingAverage_t *self = context;`) and nowhere else.
- **Costs.** An indirect call is a few cycles and the tables cost flash. On a Cortex-M this is usually irrelevant, but not in an interrupt that runs every 10 microseconds. There, the link-time variant is free.

And the biggest trap: **SOLID is a set of guidelines, not a law**. Splitting a 30 line function into five modules with function pointer tables because "the principle says so" is its own kind of spaghetti. Apply a principle when there is a real reason to change, a second implementation, or a unit test that cannot be written without it. Not before.

If you remember one sentence from this article, let it be this one: **the principles are about the direction of dependencies and the size of the pieces, not about classes.** C++ gives you classes, C gives you modules and function pointers. The good design needs neither of them to be fancy.
