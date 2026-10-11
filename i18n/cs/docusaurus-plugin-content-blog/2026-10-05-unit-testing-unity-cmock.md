---
title: "Unit testing embedded C on your PC with Unity and CMock"
slug: unit-testing-unity-cmock
date: 2026-10-05T10:00:00
authors: [Mr.Nobody]
tags: [embedded, c, testing]
---

"Embedded software cannot be unit tested, you need the hardware." I hear it often, and it is true for exactly one kind of code: the code that touches the registers. All the rest, the state machines, the protocol parsers, the control logic, the conversion of the values, is plain C that compiles on your PC. And on your PC it runs in milliseconds, without a debugger, without a cable and without flashing.

This article shows how to test a module with [Unity](https://github.com/ThrowTheSwitch/Unity) (the test framework) and [CMock](https://github.com/ThrowTheSwitch/CMock) (the generator of mocks), from the design that makes it possible to the CMake file that builds it. Everything was built and run, and the output below is the real one.

<!-- truncate -->

## What you need to test, and what you need to remove

A unit test runs one module in isolation. The module under test calls the lower layer (the BSP, a driver, another module), and **that** is the problem: the lower layer needs hardware. The solution is not to give the module a simulated hardware, but to replace the whole lower layer with something the test controls. That something is a **mock**: a function with the same signature as the real one, which does not do anything real. It only remembers how it was called and returns what the test told it to return.

This works only if the module has a place where the lower layer can be replaced. In the article about [SOLID principles](/blog/solid-principles-c-cpp) there was the *link-time injection*: the module calls a function that is declared in a header (`Bsp_Thermostat.h`), and the build system decides which source file implements it. On the target it is the real BSP, in the unit test it is the mock. This is the same principle as the architecture from the article about [design and architecture](/blog/design-architecture): when the layers have clean interfaces, every layer can be tested without the layers below.

## The tools

- **Unity** is a framework with assertions (`TEST_ASSERT_TRUE`, `TEST_ASSERT_EQUAL_UINT8`, `TEST_ASSERT_EQUAL_FLOAT`, `TEST_ASSERT_EQUAL_MEMORY` and many more) and a small script that generates the `main()` with the list of the tests from your test file, so you never have to register a test by hand. It is a few C files that are compiled together with the test.
- **CMock** reads a header file and generates the mock of every function in it: `MockBsp_Thermostat.c/.h`. It is written in Ruby, but only the *generator* is, the generated mock is plain C.
- **Ruby** is needed for the two generators, which run at build time. It does not end up in the tested code.

In the Embedbits platform these three are artifacts (`unity`, `cmock` and `ruby`), so the project does not depend on what is installed on the PC of the developer. The versions are in `ArtifactsConfig.txt` (the syntax is `<artifact_name>;<binary_version>;<handler_version>`). In this article I used Unity 2.6.1 and CMock 2.6.0 with plain CMake, so that the example works everywhere.

## The module under test

A thermostat with a hysteresis. It reads the temperature from the BSP and switches a heater on below 20 °C and off above 22 °C. If the sensor does not answer, it switches the heater off, because a heater without a measurement is a fire. The interface to the hardware is a header with two functions:

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

The public port of the module and its implementation:

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

The module does not include any hardware header, it does not know STM32 and it can be compiled with the compiler of your PC. This is the first test of the design: if it does not compile, it is not separated enough.

## The test

The test file includes the header of the module under test and the header of the **mock**, which does not exist yet. It is generated from `Bsp_Thermostat.h` during the build.

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

Let us read it from the top.

- `setUp()` is called by Unity before every test. The module keeps its state in a `static` variable, so each test starts with `Thermostat_Init()`, and `Bsp_Set_Heater_Expect(false)` tells the mock that the initialization switches the heater off. Without this reset the tests would depend on each other and on their order.
- `Sensor_Returns()` is a helper that says "the next call of `Bsp_Get_Celsius()` returns `true` and sets the value to this temperature". `_ExpectAnyArgsAndReturn` means "I do not care about the pointer", and `_ReturnThruPtr_celsius` fills the output parameter.
- Each test is a short story in three parts: the sensor says something, the module is run (`Thermostat_Task()`), the result is checked. The expectation `Bsp_Set_Heater_Expect(true)` is also an assertion: if the module calls the function with another value, or does not call it, the test fails.
- The third test shows the strength of mocks. Inside the hysteresis band nothing is expected, and that is the assertion: the mock fails the test as soon as the module calls `Bsp_Set_Heater()`.

A trap that is worth knowing: `_ReturnThruPtr_celsius(&value)` does not copy the value in the moment of the call, it remembers the **pointer** and reads the value when the module calls the mock. If `value` is a local variable of the helper, it is gone by then. The first version of the example for this article had the helper written this way, and the result was four failed tests with a message that looks like a bug in the module:

```text
test_HeaterSwitchesOnBelowLowerLimit:FAIL: Expected 1 Was 0. Function Bsp_Set_Heater
Argument on. Function called with unexpected argument value.
```

The module was correct, the variable was garbage. That is why the example has the `static float sensorCelsius` with the comment.

## The build

Two generators and one executable. CMake runs the generators before the compilation, and a change of a header regenerates the mock:

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

The configuration of CMock (`cmock.yml`) has only the list of the plugins: `ignore`, `expect_any_args` and `return_thru_ptr`, which give the `_Ignore`, `_ExpectAnyArgs` and `_ReturnThruPtr_` functions that the test above uses. The `mock_path` is relative to the folder where the generator runs, which is the build directory.

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

Notice what is *not* in the executable: no startup code, no linker script, no HAL, no ST header. Only the module, the mock, the test and the framework. It builds in a couple of seconds and runs in milliseconds, so it can run on every save and on every commit.

## Does the test really test something?

A test that cannot fail is worth nothing. The cheapest check is a **mutation**: break the code on purpose and see whether a test notices. I changed the upper limit from 22 °C to 20 °C, which removes the hysteresis:

```text
test_HeaterSwitchesOnBelowLowerLimit:PASS
test_HeaterSwitchesOffAboveUpperLimit:PASS
test_HeaterKeepsStateInsideHysteresis:FAIL:Function Bsp_Set_Heater.  Called more times than expected.
test_HeaterSwitchesOffWhenSensorFails:PASS

4 Tests 1 Failures 0 Ignored
```

The hysteresis test caught the bug, and the message says what happened: the module called `Bsp_Set_Heater()` when it should not. It is a good habit to do it once for every new test.

## What to mock and what not

- **Mock the boundary of the module, not its insides.** The mock replaces the interface of the lower layer (here `Bsp_Thermostat.h`). Do not mock your own helper functions in the same module: the test then describes how the code is written and breaks with every refactoring, even when the behavior is the same.
- **Test through the public port.** The test includes `Thermostat_Port.h` and nothing else of the module. If you need the internal header to test something, it is a sign that the module has two responsibilities. Read the article about [file organization](/blog/file-organization-embedded-c) for how the public and the internal files are separated.
- **One behavior, one test.** The name says what is expected (`HeaterSwitchesOffWhenSensorFails`), so a red test tells you what is broken before you open it.
- **The same pattern works in every layer.** A module of the application is tested with the mock of the BSP interface, a module of the MCAL with the mock of the RAL port. In every case the layer below is replaced and the layer under test is real.
- **Call order.** CMock can check that the calls of different mocks happen in a given order (the option `:enforce_strict_ordering`). It is useful for initialization sequences, but use it only where the order is a requirement and not an accident of the implementation.

## What the host test cannot tell you

I do not want to sell the host tests as everything. They do not find:

- the **timing**, the interrupts and the race conditions between them,
- the **registers**: that the pin really goes high, that the peripheral clock was switched on. That is the job of the code in the RAL and the MCAL and it needs a simulator or the real hardware,
- the **differences between the PC and the MCU**: the width of `int`, the alignment, the optimizer of the target compiler. The tests on the PC show the logic is right, not that the firmware is.

That is why the host tests are the bottom of the pyramid: many, fast, and they run on every commit. Above them are a simulator (for example Renode) and the hardware tests, which are fewer and slower and cover what the PC cannot.

## Summary

1. Design the module so that everything under it is behind a header (the *seam*).
2. Let CMock generate the mock from that header, and Unity the runner from the test file.
3. Build one small executable for the PC: the module, the mock, the test, the framework.
4. Write the tests as stories: the mock says what the world looks like, the module acts, the assertion checks the result.
5. Break the code once on purpose to see that the test fails.

The whole example is about 150 lines of code, and the next time somebody asks you whether the thermostat really switches the heater off when the sensor fails, you do not need a heater. You run `ctest`.
