---
title: "Принципи SOLID: від класів C++ до звичайного C"
slug: solid-principles-c-cpp
date: 2026-10-03T21:00:00
authors: [Mr.Nobody]
tags: [embedded, architecture, c, cpp]
---

П'ять літер, які, здається, є на кожній співбесіді з розробки програмного забезпечення. S, O, L, I та D. Принципи описано для об'єктно-орієнтованих мов, тож поширений висновок такий: «SOLID - для C++ та Java, ми пишемо на C, отже, нас це не стосується». Цей висновок хибний, і я спробую показати чому. Для кожного принципу ви знайдете оригінальну ідею з прикладом на C++, а потім ту саму ідею на C, без класів, без наслідування і без жодного `virtual`.

<!-- truncate -->

## Звідки береться SOLID

Принципи зібрав Роберт К. Мартін («дядько Боб») на початку 2000-х, а саму абревіатуру вигадав Майкл Фезерс. Деякі ідеї значно старші: *принцип відкритості/закритості* походить від Бертрана Мейєра (1988), а *принцип підстановки Барбари Ліскоу* - від Барбари Ліскоу (1987).

Усі вони відповідають на одне запитання: **як писати код, що переживає зміни?** Не код, який працює сьогодні, а код, який можна розширювати, тестувати й підтримувати хлопцеві з цитати на першій сторінці, який знає, де ви живете.

Приклади на C++ використовують класи та віртуальні функції, бо саме так принципи пояснювали спочатку. Приклади на C дотримуються [мого стилю кодування](/docs/platform/embi-platform/coding-style): імена `Module_Function`, типи `_t` і змінні зі змістовними іменами. Один виняток заради довжини: я використовую прості `uint8_t`, `uint32_t` і `float` там, де справжній проєкт мав би власні typedef (`temperature_t`, `voltage_t`), чого вимагає стиль кодування. Усі приклади в цій статті було скомпільовано (`gcc -std=c11 -Wall -Wextra -pedantic` та `g++ -std=c++17`) і запущено з невеликим модульним тестом, включно з «поганими».

### Чим насправді є клас

Перш ніж почати, коротке нагадування, що компілятор робить за лаштунками. Клас C++ з віртуальними функціями - це:

- `struct` з даними об'єкта,
- прихований вказівник у цій структурі на таблицю вказівників на функції (*vtable*), по одній таблиці на клас,
- домовленість, що кожен метод отримує вказівник на об'єкт першим параметром (`this`).

У C ми можемо написати точнісінько те саме вручну: `struct` з даними, `const struct` з вказівниками на функції та `void *context` як заміну `this`. Пам'ятайте про це, уся стаття на цьому побудована. C++ не дає тут нової можливості, він лише пише за вас шаблонний код і перевіряє його під час компіляції.

## S - Single Responsibility Principle (принцип єдиної відповідальності)

> Модуль повинен мати одну, і лише одну, причину для змін.

Важлива тут «причина для змін». Це не означає «клас має один метод». Це означає, що кожна частина коду відповідає перед одним джерелом змін: коли замінюють датчик, змінюється лише перетворення, коли замовник хоче інший формат журналу, змінюється лише форматування.

### На C++

Наступний клас робить усе: читає АЦП, перетворює значення, форматує текст і надсилає його. Чотири причини для змін в одному місці:

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

Кожна зміна (новий датчик, журнал у CAN замість UART, інший формат тексту) править той самий клас, і нічого з цього не можна протестувати без hardware. Розв'язок - розділити відповідальності й дозволити монітору лише з'єднувати їх:

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

### На C

Точно така сама помилка можлива, і поширена, у звичайному C, де зазвичай виглядає як одна довга функція в `main.c`:

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

Інструмент розділення в C - це **модуль**: пара файлів `.h`/`.c` зі спільним префіксом, де заголовок - публічний інтерфейс, а все інше - `static`. Один модуль, одна відповідальність:

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

Модуль АЦП (`Adc.h`) - та сама ідея, а монітор лише з'єднує модулі між собою:

```c title="Monitor.c"
#include "Adc.h"
#include "Logger.h"
#include "Tmp36.h"

void Monitor_Run(void)
{
    Logger_Print_Temperature(Tmp36_Get_Celsius(Adc_Read()));
}
```

Якщо TMP36 замінюють на NTC, міняється лише `Tmp36.c`. Якщо журнал іде в CAN замість UART, змінюється лише `Logger.c`. А `Tmp36_Get_Celsius()` можна протестувати на вашому PC звичайним `assert`, бо вона не торкається жодного регістра.

## O - Open/Closed Principle (принцип відкритості/закритості)

> Програмні сутності повинні бути відкритими для розширення, але закритими для модифікації.

Ви повинні мати можливість додавати нову поведінку, не редагуючи код, який уже працює й протестований. Типовий запах - `switch` за типом, який росте з кожною новою функцією.

### На C++

Конвеєр нижче доводиться змінювати для кожного нового фільтра, включно з `enum` і `switch`:

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

Рішення - абстракція (інтерфейс), яку знає конвеєр і яку реалізують нові фільтри:

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

Новий фільтр - це новий клас. `SamplePipeline` закритий для модифікації, а система відкрита для розширення.

### На C

Та сама проблема з `switch` у C:

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

Замінник віртуальної таблиці в C - це **таблиця вказівників на функції** та `void *context` для даних екземпляра. Абстракція визначається один раз:

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

Кожен фільтр - це пара з даних (`context`) і константної таблиці з поведінкою:

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

Другий фільтр - це цілком окремий модуль, перший не чіпали:

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

Конвеєр знає лише `filter_t`, тож його більше ніколи не потрібно змінювати:

```c title="Pipeline.c"
#include "Filter.h"

float Pipeline_Feed(const filter_t *filter, float sample)
{
    return Filter_Process(filter, sample);   /* never changes again */
}
```

А ось як це використовується. Обидва фільтри працюють з тим самим конвеєром:

```c
movingAverage_t average = {0};
const filter_t averageFilter = { &movingAverageOps, &average };

median3_t median = {0};
const filter_t medianFilter = { &median3Ops, &median };

float output = Pipeline_Feed(&medianFilter, sample);
```

Таблиці `const`, тому живуть у flash і не коштують RAM. Те, що компілятор C++ генерує для `virtual`, - це саме воно.

## L - Liskov Substitution Principle (принцип підстановки Ліскоу)

> Об'єкти підтипу повинні бути придатними всюди, де очікується базовий тип, так, щоб викликач не помічав різниці.

Це найменш зрозумілий принцип. Він не про синтаксис (його перевіряє компілятор), а про **контракт**. Похідний клас не повинен вимагати більше, ніж обіцяє базовий, і не повинен постачати менше. Якщо викликачу потрібен `if (typeid(...))`, принцип порушено.

### На C++

Три пристрої зберігання за одним інтерфейсом. Який із них порушує контракт?

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

`Flash` вимагає вирівняних адрес і довжин, чого базовий клас ніколи не згадував, тож код, який зберігає п'ять байтів, працює з `Eeprom` і мовчки провалюється з `Flash`. `RomImage` кидає виняток у системі, яка, імовірно, збирається з `-fno-exceptions`. Усі три компілюються, і лише один поводиться як слід.

Виправлення - дотримуватися контракту в реалізації та не наслідувати, коли можливості немає:

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

### На C

У C немає наслідування, тож принцип нерелевантний? Навпаки, таблиця вказівників на функції - це інтерфейс так само, як у C++, і проблема підстановки та сама. У C вона навіть небезпечніша, бо типові порушення - це `NULL` у таблиці або `assert` у реалізації:

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

Ліки ті самі, що й у C++, плюс одна звичка: **запишіть контракт у заголовку** і змусьте всі реалізації його виконувати. Жодного `NULL` у таблиці, жодного assert на помилку викликача, жодної прихованої передумови:

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

`Settings_Save()` працює з flash, з образом ROM (він отримує нормальний код помилки) і з будь-якою реалізацією, що з'явиться пізніше.

## I - Interface Segregation Principle (принцип розділення інтерфейсів)

> Клієнтів не слід змушувати залежати від методів, якими вони не користуються.

«Товстий» інтерфейс зв'язує всіх з усім. Коли UART отримує новий метод, кожен клієнт і кожен mock треба перекомпілювати й переглянути, хоча вони хотіли лише надсилати байти.

### На C++

Логеру потрібен один метод, але він залежить від п'яти:

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

Інтерфейс розділено за роллю клієнта. Конфігурація лишається на конкретному класі, а логер просить лише можливість записувати байти:

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

Mock для тесту логера тепер має один метод замість п'яти.

### На C

Товстий інтерфейс існує і в C: як величезна структура вказівників на функції або, частіше, як один гігантський заголовний файл `Uart.h`, який включають усі:

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

Є два інструменти. Перший такий самий, як у C++: малий інтерфейс (`byteSink_t`), що несе лише те, що потрібно клієнтові:

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

Другий специфічний для C: **розділіть заголовок**. Усі, хто лише надсилає байти, включають `Uart_Tx.h`, і ніхто інший не бачить конфігурації:

```c
/* Uart_Config.h  - used by the code that sets the peripheral up */
void Uart_Init(uart_t *uart, uint32_t baudrate);
void Uart_Set_Parity(uart_t *uart, uartParity_t parity);

/* Uart_Tx.h      - used by everybody who only sends */
void Uart_Send(uart_t *uart, const uint8_t *data, size_t length);

/* Uart_Rx.h      - used by everybody who only receives */
size_t Uart_Receive(uart_t *uart, uint8_t *data, size_t maxLength);
```

Логер можна протестувати трирядковою функцією, що перехоплює байти. Він не знає, що UART існує.

## D - Dependency Inversion Principle (принцип інверсії залежностей)

> Модулі високого рівня не повинні залежати від модулів низького рівня. Обидва повинні залежати від абстракцій. Абстракції не повинні залежати від деталей.

Це принцип, що пов'язує решту чотирьох. Саме він стоїть за шарами зі статті про [проєктування та архітектуру](/blog/design-architecture): застосунок не повинен знати, який регістр перемикає світлодіод.

### На C++

Термостат (політика високого рівня) містить класи АЦП і GPIO (деталі низького рівня). Його не можна скомпілювати без hardware, не можна протестувати на PC і не можна перенести на іншу плату:

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

Після інверсії інтерфейси належать політиці, а драйвери їх реалізують. Стрілка залежності вказує на політику:

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

### На C

C пропонує два способи, і другий унікальний для C та дешевший за будь-який віртуальний виклик.

**1. Ін'єкція під час виконання** через вказівники на функції, точнісінько як у прикладі про відкритість/закритість. Інтерфейс належить термостату (він у `Thermostat.h`), драйвери його заповнюють:

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

У модульному тесті ви передаєте функції, що повертають число й запам'ятовують стан нагрівача. На цільовій платформі ви передаєте `Adc_Get_Celsius` та `Gpio_Set_Heater`, а `Thermostat.c` лишається недоторканим.

**2. Ін'єкція під час лінкування.** Іноді реалізації не потрібно перемикати під час виконання, достатньо ухвалити рішення один раз, у системі збірки. Тоді абстракція - це **заголовок з оголошеннями**, а реалізація - вихідний файл, який CMake обирає для цілі:

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

Для плати лінкується `Bsp_Thermostat_Stm32.c`, що реалізує обидві функції зі справжньою периферією. У модульному тесті на PC натомість лінкується `Bsp_Thermostat_Fake.c`. Жодних вказівників на функції, жодної непрямості, жодної RAM, а термостат і далі повністю незалежний від hardware. Це, до речі, саме те, що робить BSP від Embedbits: застосунок викликає інтерфейс BSP і не переймається, яка родина чи яка плата за ним стоїть.

## Ті самі ідеї в двох мовах

| Принцип | C++ | C |
|---|---|---|
| **S** | клас | модуль (пара `.h`/`.c`, префікс, `static`) |
| **O** | абстрактний клас, `virtual`, `override` | `const` таблиця вказівників на функції + `void *context` |
| **L** | контракт базового класу | контракт, записаний у заголовку, без `NULL` у таблиці |
| **I** | кілька малих інтерфейсів | малі структури вказівників, розділені заголовки |
| **D** | ін'єкція інтерфейсу через конструктор | вказівники на функції в `struct` або ін'єкція під час лінкування |

## Чого компілятор за вас не зробить

Треба бути чесним. C++ має переваги, які в C доводиться замінювати дисципліною:

- **Немає перевірки під час компіляції.** Якщо забути поле таблиці функцій, компілятор мовчить (designated initializers принаймні називають поля, а в C пропущене стає `NULL`). Використовуйте ініціалізатори `.Process = ...`, ніколи позиційні, і майте модульний тест, що викликає кожну функцію кожної реалізації.
- **`void *context` не є типобезпечним.** Неправильне приведення компілятор не знайде. Тримайте приведення в одному рядку на початку кожної функції (`movingAverage_t *self = context;`) і ніде більше.
- **Вартість.** Непрямий виклик - це кілька тактів, а таблиці займають flash. На Cortex-M це зазвичай неістотно, але не в перериванні, що виконується кожні 10 мікросекунд. Там варіант із лінкуванням безкоштовний.

І найбільша пастка: **SOLID - це набір настанов, а не закон**. Розбити функцію на 30 рядків на п'ять модулів із таблицями вказівників на функції, бо «так каже принцип», - це свій різновид спагеті. Застосовуйте принцип, коли є справжня причина для змін, друга реалізація або модульний тест, який неможливо написати без нього. Не раніше.

Якщо ви запам'ятаєте з цієї статті одне речення, нехай це буде таке: **принципи стосуються напрямку залежностей і розміру частин, а не класів.** C++ дає вам класи, C дає модулі й вказівники на функції. Для хорошого дизайну не потрібне ні те, ні інше, щоб бути вигадливим.
