---
title: "Unit-тестування вбудованого C на вашому ПК за допомогою Unity і CMock"
slug: unit-testing-unity-cmock
date: 2026-10-05T10:00:00
authors: [Mr.Nobody]
tags: [embedded, c, testing]
---

«Вбудоване ПЗ неможливо тестувати unit-тестами, для цього потрібна апаратна частина». Я чую це часто, і це правда рівно для одного виду коду: того, що торкається регістрів. Усе решта — скінченні автомати, парсери протоколів, логіка керування, перетворення значень — це звичайний C, який компілюється на вашому ПК. А на вашому ПК він виконується за мілісекунди, без налагоджувача, без кабелю і без прошивання.

Ця стаття показує, як тестувати модуль за допомогою [Unity](https://github.com/ThrowTheSwitch/Unity) (тестовий фреймворк) і [CMock](https://github.com/ThrowTheSwitch/CMock) (генератор моків) — від дизайну, який це уможливлює, до файлу CMake, що все збирає. Усе було зібрано й запущено, а вивід нижче справжній.

<!-- truncate -->

## Що потрібно тестувати і що потрібно прибрати

Unit-тест запускає один модуль в ізоляції. Модуль, що тестується, викликає нижній шар (BSP, драйвер, інший модуль), і **саме в цьому** проблема: нижньому шару потрібна апаратна частина. Рішення — не давати модулю симульовану апаратну частину, а замінити весь нижній шар чимось, чим керує тест. Це «щось» — **мок** (mock): функція з тим самим сигнатурою, що й справжня, яка не робить нічого справжнього. Вона лише запам'ятовує, як її викликали, і повертає те, що їй наказав повернути тест.

Це працює лише тоді, коли в модулі є місце, де нижній шар можна замінити. У статті про [принципи SOLID](/blog/solid-principles-c-cpp) йшлося про *link-time injection*: модуль викликає функцію, оголошену в заголовку (`Bsp_Thermostat.h`), а система збірки вирішує, який вихідний файл її реалізує. На цільовій платформі це справжній BSP, в unit-тесті — мок. Це той самий принцип, що й в архітектурі зі статті про [дизайн і архітектуру](/blog/design-architecture): коли шари мають чисті інтерфейси, кожен шар можна тестувати без шарів під ним.

## Інструменти

- **Unity** — фреймворк з перевірками (`TEST_ASSERT_TRUE`, `TEST_ASSERT_EQUAL_UINT8`, `TEST_ASSERT_EQUAL_FLOAT`, `TEST_ASSERT_EQUAL_MEMORY` та багато інших) і невеликий скрипт, що генерує `main()` зі списком тестів з вашого тестового файлу, тож вам ніколи не доведеться реєструвати тест вручну. Це кілька C-файлів, які компілюються разом із тестом.
- **CMock** читає заголовковий файл і генерує мок кожної функції в ньому: `MockBsp_Thermostat.c/.h`. Він написаний на Ruby, але на Ruby написаний лише *генератор*, а згенерований мок — звичайний C.
- **Ruby** потрібен для двох генераторів, які виконуються під час збірки. У тестований код він не потрапляє.

На платформі Embedbits ці три інструменти — артефакти (`unity`, `cmock` і `ruby`), тож проєкт не залежить від того, що встановлено на ПК розробника. Версії зберігаються в `ArtifactsConfig.txt` (синтаксис `<artifact_name>;<binary_version>;<handler_version>`). У цій статті я використав Unity 2.6.1 та CMock 2.6.0 зі звичайним CMake, щоб приклад працював усюди.

## Модуль, що тестується

Термостат із гістерезисом. Він зчитує температуру з BSP, вмикає нагрівач нижче 20 °C і вимикає вище 22 °C. Якщо датчик не відповідає, він вимикає нагрівач, бо нагрівач без вимірювання — це пожежа. Інтерфейс до апаратної частини — заголовок із двома функціями:

```c title="Bsp_Thermostat.h"
#ifndef BSP_THERMOSTAT_H
#define BSP_THERMOSTAT_H

#include <stdbool.h>

/* Implemented by the BSP of the board - or mocked in the unit test. */

/* Returns false if the sensor does not answer, the value is then not valid. */
bool Bsp_Get_Celsius(float *celsius);

void Bsp_Set_Heater(bool on);

#endif
```

Публічний порт модуля та його реалізація:

```c title="Thermostat_Port.h"
#ifndef THERMOSTAT_THERMOSTAT_PORT_H
#define THERMOSTAT_THERMOSTAT_PORT_H

#include <stdbool.h>

void Thermostat_Init(void);
void Thermostat_Task(void);
bool Thermostat_Is_HeaterOn(void);

#endif
```
```c title="Thermostat.c"
#include "Thermostat_Port.h"
#include "Bsp_Thermostat.h"

#define THERMOSTAT_SWITCH_ON_CELSIUS   ( 20.0f )
#define THERMOSTAT_SWITCH_OFF_CELSIUS  ( 22.0f )

static bool isHeaterOn;

static void Thermostat_Set_Heater(bool on)
{
    isHeaterOn = on;
    Bsp_Set_Heater(on);
}

void Thermostat_Init(void)
{
    Thermostat_Set_Heater(false);
}

void Thermostat_Task(void)
{
    float celsius = 0.0f;

    if (!Bsp_Get_Celsius(&celsius))
    {
        Thermostat_Set_Heater(false);          /* fail safe: no value, no heating */
    }
    else if (celsius < THERMOSTAT_SWITCH_ON_CELSIUS)
    {
        Thermostat_Set_Heater(true);
    }
    else if (celsius > THERMOSTAT_SWITCH_OFF_CELSIUS)
    {
        Thermostat_Set_Heater(false);
    }
    else
    {
        /* inside the hysteresis band: keep the current state */
    }
}

bool Thermostat_Is_HeaterOn(void)
{
    return isHeaterOn;
}
```

Модуль не підключає жодного апаратного заголовка, нічого не знає про STM32 і може бути скомпільований компілятором вашого ПК. Це перший тест дизайну: якщо він не компілюється, модуль відокремлено недостатньо.

## Тест

Тестовий файл підключає заголовок модуля, що тестується, і заголовок **моку**, якого ще не існує. Його генерують із `Bsp_Thermostat.h` під час збірки.

```c title="test_Thermostat.c"
#include "unity.h"
#include "Thermostat_Port.h"
#include "MockBsp_Thermostat.h"

void setUp(void)
{
    Bsp_Set_Heater_Expect(false);
    Thermostat_Init();
}

void tearDown(void)
{
}

/* The mock reads this variable when Thermostat_Task() calls it, so it has to outlive the helper. */
static float sensorCelsius;

/* Helper: the sensor answers with the given temperature. */
static void Sensor_Returns(float celsius)
{
    sensorCelsius = celsius;
    Bsp_Get_Celsius_ExpectAnyArgsAndReturn(true);
    Bsp_Get_Celsius_ReturnThruPtr_celsius(&sensorCelsius);
}

void test_HeaterSwitchesOnBelowLowerLimit(void)
{
    Sensor_Returns(18.0f);
    Bsp_Set_Heater_Expect(true);

    Thermostat_Task();

    TEST_ASSERT_TRUE(Thermostat_Is_HeaterOn());
}

void test_HeaterSwitchesOffAboveUpperLimit(void)
{
    Sensor_Returns(18.0f);
    Bsp_Set_Heater_Expect(true);
    Thermostat_Task();

    Sensor_Returns(23.0f);
    Bsp_Set_Heater_Expect(false);
    Thermostat_Task();

    TEST_ASSERT_FALSE(Thermostat_Is_HeaterOn());
}

void test_HeaterKeepsStateInsideHysteresis(void)
{
    Sensor_Returns(18.0f);
    Bsp_Set_Heater_Expect(true);
    Thermostat_Task();

    Sensor_Returns(21.0f);          /* no Bsp_Set_Heater expected: the mock fails the test if it is called */
    Thermostat_Task();

    TEST_ASSERT_TRUE(Thermostat_Is_HeaterOn());
}

void test_HeaterSwitchesOffWhenSensorFails(void)
{
    Sensor_Returns(18.0f);
    Bsp_Set_Heater_Expect(true);
    Thermostat_Task();

    Bsp_Get_Celsius_ExpectAnyArgsAndReturn(false);
    Bsp_Set_Heater_Expect(false);
    Thermostat_Task();

    TEST_ASSERT_FALSE(Thermostat_Is_HeaterOn());
}
```

Прочитаймо його згори.

- `setUp()` викликається Unity перед кожним тестом. Модуль зберігає свій стан у `static`-змінній, тож кожен тест починається з `Thermostat_Init()`, а `Bsp_Set_Heater_Expect(false)` повідомляє моку, що ініціалізація вимикає нагрівач. Без цього скидання тести залежали б одне від одного та від порядку їх виконання.
- `Sensor_Returns()` — допоміжна функція, яка каже: «наступний виклик `Bsp_Get_Celsius()` повертає `true` і встановлює значення в цю температуру». `_ExpectAnyArgsAndReturn` означає «мені байдуже, який вказівник», а `_ReturnThruPtr_celsius` заповнює вихідний параметр.
- Кожен тест — це коротка історія з трьох частин: датчик щось повідомляє, модуль запускається (`Thermostat_Task()`), результат перевіряється. Очікування `Bsp_Set_Heater_Expect(true)` також є перевіркою: якщо модуль викличе функцію з іншим значенням або не викличе її взагалі, тест впаде.
- Третій тест показує силу моків. Усередині смуги гістерезису нічого не очікується, і це і є перевірка: мок валить тест, щойно модуль викликає `Bsp_Set_Heater()`.

Пастка, про яку варто знати: `_ReturnThruPtr_celsius(&value)` не копіює значення в момент виклику, а запам'ятовує **вказівник** і зчитує значення, коли модуль викликає мок. Якщо `value` — локальна змінна допоміжної функції, до того часу її вже не існує. Перша версія прикладу для цієї статті мала допоміжну функцію, написану саме так, і результатом стали чотири впалі тести з повідомленням, що виглядає як помилка в модулі:

```text
test_HeaterSwitchesOnBelowLowerLimit:FAIL: Expected 1 Was 0. Function Bsp_Set_Heater
Argument on. Function called with unexpected argument value.
```

Модуль був правильним, а змінна — сміттям. Ось чому в прикладі є `static float sensorCelsius` з коментарем.

## Збірка

Два генератори й один виконуваний файл. CMake запускає генератори перед компіляцією, а зміна заголовка перегенеровує мок:

```yaml title="cmock.yml"
:cmock:
  :mock_path: mocks
  :plugins:
    - :ignore
    - :expect_any_args
    - :return_thru_ptr
```
```cmake title="CMakeLists.txt"
cmake_minimum_required(VERSION 3.19)
project(ThermostatTests C)
enable_testing()

find_program(RUBY ruby REQUIRED)
set(UNITY_DIR  ${CMAKE_SOURCE_DIR}/../unity)
set(CMOCK_DIR  ${CMAKE_SOURCE_DIR}/../cmock)
set(MOCK_DIR   ${CMAKE_BINARY_DIR}/mocks)
set(TEST_NAME  test_Thermostat)

# 1. mock of the BSP interface, generated from its header
add_custom_command(
    OUTPUT  ${MOCK_DIR}/MockBsp_Thermostat.c ${MOCK_DIR}/MockBsp_Thermostat.h
    COMMAND ${RUBY} ${CMOCK_DIR}/lib/cmock.rb -o${CMAKE_SOURCE_DIR}/cmock.yml
            ${CMAKE_SOURCE_DIR}/src/Bsp_Thermostat.h
    WORKING_DIRECTORY ${CMAKE_BINARY_DIR}
    DEPENDS ${CMAKE_SOURCE_DIR}/src/Bsp_Thermostat.h ${CMAKE_SOURCE_DIR}/cmock.yml
)

# 2. the test runner (main + list of the tests), generated from the test file
add_custom_command(
    OUTPUT  ${CMAKE_BINARY_DIR}/${TEST_NAME}_Runner.c
    COMMAND ${RUBY} ${UNITY_DIR}/auto/generate_test_runner.rb
            ${CMAKE_SOURCE_DIR}/test/${TEST_NAME}.c ${CMAKE_BINARY_DIR}/${TEST_NAME}_Runner.c
    DEPENDS ${CMAKE_SOURCE_DIR}/test/${TEST_NAME}.c
)

# 3. one test executable: the module under test + the mock + the test + the framework
add_executable(${TEST_NAME}
    src/Thermostat.c
    test/${TEST_NAME}.c
    ${CMAKE_BINARY_DIR}/${TEST_NAME}_Runner.c
    ${MOCK_DIR}/MockBsp_Thermostat.c
    ${UNITY_DIR}/src/unity.c
    ${CMOCK_DIR}/src/cmock.c
)
target_include_directories(${TEST_NAME} PRIVATE src ${MOCK_DIR} ${UNITY_DIR}/src ${CMOCK_DIR}/src)
target_compile_options(${TEST_NAME} PRIVATE -Wall -Wextra)

add_test(NAME ${TEST_NAME} COMMAND ${TEST_NAME})
```

Конфігурація CMock (`cmock.yml`) містить лише список плагінів: `ignore`, `expect_any_args` і `return_thru_ptr`, які дають функції `_Ignore`, `_ExpectAnyArgs` та `_ReturnThruPtr_`, що використовує тест вище. `mock_path` задається відносно папки, з якої запускається генератор, тобто каталогу збірки.

```bash
cmake -S . -B build
cmake --build build
./build/test_Thermostat        # or: ctest --test-dir build
```

```text
test_Thermostat.c:26:test_HeaterSwitchesOnBelowLowerLimit:PASS
test_Thermostat.c:36:test_HeaterSwitchesOffAboveUpperLimit:PASS
test_Thermostat.c:49:test_HeaterKeepsStateInsideHysteresis:PASS
test_Thermostat.c:61:test_HeaterSwitchesOffWhenSensorFails:PASS

-----------------------
4 Tests 0 Failures 0 Ignored
OK
```

Зверніть увагу, чого у виконуваному файлі *немає*: ні startup-коду, ні linker script, ні HAL, ні заголовків ST. Лише модуль, мок, тест і фреймворк. Він збирається за пару секунд і виконується за мілісекунди, тож його можна запускати при кожному збереженні та кожному коміті.

## Чи справді тест щось тестує?

Тест, який не може впасти, нічого не вартий. Найдешевша перевірка — **мутація**: навмисно зламати код і подивитися, чи помітить це якийсь тест. Я змінив верхню межу з 22 °C на 20 °C, що прибирає гістерезис:

```text
test_HeaterSwitchesOnBelowLowerLimit:PASS
test_HeaterSwitchesOffAboveUpperLimit:PASS
test_HeaterKeepsStateInsideHysteresis:FAIL:Function Bsp_Set_Heater.  Called more times than expected.
test_HeaterSwitchesOffWhenSensorFails:PASS

4 Tests 1 Failures 0 Ignored
```

Тест гістерезису виявив помилку, а повідомлення каже, що сталося: модуль викликав `Bsp_Set_Heater()`, коли не мав. Корисна звичка — робити так один раз для кожного нового тесту.

## Що мокати, а що ні

- **Мокайте межу модуля, а не його нутрощі.** Мок замінює інтерфейс нижнього шару (тут `Bsp_Thermostat.h`). Не мокайте власні допоміжні функції в тому самому модулі: тоді тест описує, як написаний код, і ламається при кожному рефакторингу, навіть коли поведінка та сама.
- **Тестуйте через публічний порт.** Тест підключає `Thermostat_Port.h` і більше нічого з модуля. Якщо для тестування чогось потрібен внутрішній заголовок, це ознака того, що модуль має дві відповідальності. Про те, як розділяються публічні та внутрішні файли, читайте у статті про [організацію файлів](/blog/file-organization-embedded-c).
- **Одна поведінка — один тест.** Назва каже, чого очікується (`HeaterSwitchesOffWhenSensorFails`), тож червоний тест повідомляє, що зламалося, ще до того, як ви його відкриєте.
- **Той самий шаблон працює на кожному шарі.** Модуль застосунку тестується з моком інтерфейсу BSP, модуль MCAL — з моком порту RAL. У кожному випадку нижній шар замінюється, а шар, що тестується, залишається справжнім.
- **Порядок викликів.** CMock може перевіряти, що виклики різних моків відбуваються в заданому порядку (опція `:enforce_strict_ordering`). Це корисно для послідовностей ініціалізації, але використовуйте її лише там, де порядок є вимогою, а не випадковістю реалізації.

## Чого host-тест не скаже

Я не хочу продавати host-тести як усе. Вони не знаходять:

- **таймінги**, переривання та гонки між ними,
- **регістри**: що пін справді піднявся у високий рівень, що тактування периферії було ввімкнено. Це завдання коду в RAL і MCAL, і для нього потрібен симулятор або справжня апаратна частина,
- **відмінності між ПК і MCU**: ширину `int`, вирівнювання, оптимізатор компілятора цільової платформи. Тести на ПК показують, що логіка правильна, а не що правильна прошивка.

Ось чому host-тести — це основа піраміди: їх багато, вони швидкі й запускаються на кожен коміт. Над ними стоять симулятор (наприклад, Renode) і апаратні тести, яких менше й які повільніші та покривають те, чого ПК не може.

## Підсумок

1. Проєктуйте модуль так, щоб усе під ним було за заголовком (*seam*).
2. Нехай CMock згенерує мок із цього заголовка, а Unity — runner із тестового файлу.
3. Зберіть один маленький виконуваний файл для ПК: модуль, мок, тест, фреймворк.
4. Пишіть тести як історії: мок каже, як виглядає світ, модуль діє, перевірка підтверджує результат.
5. Один раз навмисно зламайте код, щоб побачити, що тест падає.

Увесь приклад займає близько 150 рядків коду, і наступного разу, коли хтось запитає вас, чи справді термостат вимикає нагрівач, коли датчик виходить з ладу, вам не потрібен нагрівач. Ви запускаєте `ctest`.
