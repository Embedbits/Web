---
title: "Запуск справжньої прошивки без апаратної частини: симулятор у CI"
slug: firmware-in-simulator-ci
date: 2026-10-07T18:00:00
authors: [Mr.Nobody]
tags: [embedded, c, testing]
---

У статті про [unit-тестування з Unity та CMock](/blog/unit-testing-unity-cmock) я казав, що тести на ПК не знаходять «відмінностей між ПК і MCU». Ця стаття — про ці відмінності та про інструмент, який їх знаходить: **симулятор, що запускає справжній бінарний файл**. Не логіку, зібрану для ПК, а саме той `.elf`, який створив ARM-компілятор, зі справжнім startup-кодом і справжнім linker script, на моделі процесора та його периферії.

Я покажу два експерименти, які провів: той самий вихідний код тесту, що проходить на ПК і падає на Cortex-M4, та прошивку, яка пише в регістри USART за справжніми адресами STM32F4, а її текст з'являється в терміналі. Наприкінці — чесний перелік того, чого симулятор вам не скаже.

<!-- truncate -->

## Де це вписується

| Рівень | Що виконується | Що знаходить | Швидкість |
|---|---|---|---|
| **Unit-тест на ПК** | логіка, зібрана для ПК, нижні шари замоковані | помилки в логіці | мілісекунди |
| **Симулятор** | справжній бінарний файл прошивки на моделі MCU | специфічні для цільової платформи помилки, startup, драйвери проти моделі регістрів | секунди |
| **Hardware in the loop** | справжня прошивка на справжньому MCU зі справжніми сигналами | таймінги, електричну поведінку, справжню периферію | хвилини, лабораторія |

Середній рівень пропускають найчастіше, хоча його додати найдешевше до CI, який уже збирає прошивку: симулятор — це виконуваний файл, який ви запускаєте з файлом, створеним вашою збіркою.

Інструмент у моїх експериментах — QEMU 8.2.2 з машиною `netduinoplus2`, моделлю плати з **STM32F405** (Cortex-M4 з картою пам'яті справжнього чипа: flash за адресою `0x08000000`, RAM за `0x20000000`, периферія за своїми справжніми адресами). Платформа має артефакт для іншого симулятора, **Renode**, і я повернуся до нього наприкінці.

## Експеримент 1: тест, що проходить на ПК і падає на MCU

Невеликий модуль із двома функціями, які є в кожній прошивці: перетворення часу та перевірка отриманого байта.

```c title="Conversions.c"
#include "Conversions.h"

long Conversions_Get_Microseconds(uint32_t milliseconds)
{
    return (long)milliseconds * 1000L;
}

bool Conversions_Is_HighBitSet(char receivedByte)
{
    return (receivedByte < 0);
}
```

Обидві функції виглядають правильно, і обидві протестовані на ПК. Вихідний код тесту однаковий для обох платформ: відрізняється лише вивід. Файл `Platform.h` друкує через `printf` на ПК і через *semihosting* (запит до симулятора або налагоджувача) на цільовій платформі, а код завершення тесту показує, чи він пройшов:

```c title="Platform.h"
#ifndef PLATFORM_H
#define PLATFORM_H

/* The same test source runs on the PC and on the target: only the output differs. */
#if defined(__arm__)
    #include <stdint.h>
    static inline int Semihost_Call(int operation, const void *argument)
    {
        register int   r0 __asm__("r0") = operation;
        register const void *r1 __asm__("r1") = argument;
        __asm__ volatile ("bkpt 0xAB" : "+r"(r0) : "r"(r1) : "memory");
        return r0;
    }
    static inline void Platform_Print(const char *text) { (void)Semihost_Call(0x04, text); }
    static inline void Platform_Exit(int failures)
    {
        /* 0x20026: the application exited normally, 0x20023: the application failed */
        (void)Semihost_Call(0x18, (const void *)(0 == failures ? 0x20026u : 0x20023u));
    }
#else
    #include <stdio.h>
    #include <stdlib.h>
    static inline void Platform_Print(const char *text) { fputs(text, stdout); }
    static inline void Platform_Exit(int failures)      { exit(0 == failures ? 0 : 1); }
#endif

#endif
```

```c title="tests.c"
#include <stdbool.h>
#include <stdint.h>
#include "Conversions.h"
#include "Platform.h"

static int failures;

#define CHECK(condition, name)                                          \
    do {                                                                \
        if (condition) { Platform_Print("PASS  " name "\n"); }          \
        else           { Platform_Print("FAIL  " name "\n"); failures++; } \
    } while (0)

int main(void)
{
    /* 3 000 000 ms = 50 minutes = 3 000 000 000 us */
    CHECK(3000000000L == Conversions_Get_Microseconds(3000000u), "50 minutes in microseconds");
    CHECK(5000L == Conversions_Get_Microseconds(5u),             "5 ms in microseconds");

    /* the byte 0xFF is received from the UART */
    CHECK(true == Conversions_Is_HighBitSet((char)0xFF),         "0xFF has the high bit set");
    CHECK(false == Conversions_Is_HighBitSet((char)0x41),        "'A' has not the high bit set");

    Platform_Exit(failures);
    return failures;
}
```

На ПК:

```text
PASS  50 minutes in microseconds
PASS  5 ms in microseconds
PASS  0xFF has the high bit set
PASS  'A' has not the high bit set
exit code: 0
```

Той самий код, зібраний `arm-none-eabi-gcc` для Cortex-M4 і запущений у QEMU:

```text
FAIL  50 minutes in microseconds
PASS  5 ms in microseconds
FAIL  0xFF has the high bit set
PASS  'A' has not the high bit set
exit code: 1
```

Дві помилки, і обидві невидимі на ПК:

- **`long` має іншу ширину.** На 64-бітному Linux-ПК `long` має 64 біти, на Cortex-M — 32. `3 000 000 ms * 1000` дорівнює `3 000 000 000`, що не вміщується в знакове 32-бітне число (найбільше — 2 147 483 647), тож результат неправильний, а в C це ще й undefined behavior.
- **`char` має іншу знаковість.** Стандарт C залишає відкритим питання, чи є звичайний `char` знаковим. На x86 є, тож `(char)0xFF` дорівнює `-1`, і перевірка `receivedByte < 0` працює. На ARM він *беззнаковий*, тож `(char)0xFF` дорівнює `255`, і порівняння ніколи не буває істинним. ARM-компілятор навіть про це повідомляє, і лише там:

```text
Conversions.c:10:26: warning: comparison is always false due to limited range of data type [-Wtype-limits]
```

Обидві проблеми стосуються переносимих типів, що є темою правила 4.6 у статті про [MISRA](/blog/misra-c-rules-in-practice): використовуйте типи із заданими розміром і знаковістю. Виправлена версія використовує `uint64_t` для часу та `uint8_t` для байта:

```c
uint64_t Conversions_Get_Microseconds_Fixed(uint32_t milliseconds)
{
    return (uint64_t)milliseconds * 1000u;
}

bool Conversions_Is_HighBitSet_Fixed(uint8_t receivedByte)
{
    return (0u != (receivedByte & 0x80u));
}
```

і ті самі чотири перевірки тепер проходять **на обох платформах**, з кодом завершення 0 на обох. Перша версія не була помилкою тесту, і тест на ПК не був хибним: він просто тестував іншу програму.

Код завершення — це вся інтеграція з CI. Симулятор завершується з кодом, який прошивка передає у виклик semihosting, тож `add_test` у CMake (див. статтю про [CMake для прошивок](/blog/cmake-for-embedded-firmware)) падає, коли падає тест на цільовій платформі:

```cmake
add_test(NAME conversions_on_target
    COMMAND qemu-system-arm -M netduinoplus2 -nographic
            -semihosting-config enable=on,target=native -kernel conversions_test.elf)
```

## Експеримент 2: регістри периферії

Симулятор також моделює периферію, а отже, може виконуватися й код, найближчий до апаратної частини. Ось прошивка, яка надсилає текст через USART1 мікроконтролера STM32F4, написана на рівні регістрів зі справжніми адресами (без бібліотек, без startup, окрім коду зі статті про [те, що відбувається перед `main()`](/blog/before-main-startup-linker)):

```c title="uart.c"
#include <stdint.h>

/* STM32F4: RCC and USART1 registers, the same addresses as on the real chip */
#define RCC_APB2ENR  (*(volatile uint32_t *)0x40023844u)
#define USART1_SR    (*(volatile uint32_t *)0x40011000u)
#define USART1_DR    (*(volatile uint32_t *)0x40011004u)
#define USART1_CR1   (*(volatile uint32_t *)0x4001100Cu)

#define RCC_APB2ENR_USART1EN  ( 1u << 4 )
#define USART_CR1_UE          ( 1u << 13 )
#define USART_CR1_TE          ( 1u << 3 )
#define USART_SR_TXE          ( 1u << 7 )

static void Uart_Send(const char *text)
{
    while ('\0' != *text)
    {
        while (0u == (USART1_SR & USART_SR_TXE)) { }     /* wait until the data register is empty */
        USART1_DR = (uint32_t)(unsigned char)*text++;
    }
}

int main(void)
{
    RCC_APB2ENR |= RCC_APB2ENR_USART1EN;                  /* clock of the peripheral */
    USART1_CR1  |= USART_CR1_UE | USART_CR1_TE;           /* enable the USART and its transmitter */

    Uart_Send("hello from the register level\r\n");

    for (;;) { }
}
```

```text
hello from the register level
```

Текст з'явився в терміналі симулятора: прошивка ввімкнула тактування периферії в RCC, увімкнула USART та його передавач, дочекалася прапорця `TXE` і записала в регістр даних — точно так, як зробила б на платі, а модель USART передала байт на послідовний порт. Це тест драйвера проти моделі інтерфейсу регістрів. Якщо драйвер чекає на прапорець, який ніколи не приходить, тест знайде це за таймаутом, а не за столом з осцилографом.

## Чого симулятор вам не скаже

Симулятор — це *модель*, і кожна модель має межі. Кілька з них я зустрів в експериментах цієї серії:

- **Таймінги не справжні.** QEMU виконує інструкції так швидко, як дозволяє ПК, і не рахує такти справжнього ядра. Тест, який має довести, що «переривання обслуговується за 5 мікросекунд», у ньому неможливий.
- **Переривання приходять в інших місцях, ніж на MCU.** У статті про [переривання](/blog/interrupts-and-main-shared-data) втрачене оновлення спільного лічильника не з'явилося в QEMU за 200 000 спроб, бо QEMU доставляє переривання між блоками транслюваного коду. Справжній MCU може перервати після кожної інструкції. Симулятор не доводить відсутності гонки.
- **Існує лише змодельована периферія.** Модель STM32F405 має USART, але інший чип може мати периферію, якої в моделі немає або вона спрощена: регістри є, аналогової частини немає.
- **Електричного світу бракує:** брязкіт контактів, шум на вході ADC, просадка напруги. Усе, що приходить ззовні, — це те, що ви самі вкладаєте в модель.

Тож симулятор не замінює ні unit-тести (вони швидші й тестують логіку в ізоляції), ні апаратні тести (вони тестують реальність). Він знаходить те, що між ними: компілятор цільової платформи, типи, startup, карту пам'яті, драйвер проти моделі регістрів — і робить це за кілька секунд на кожен коміт.

## Renode

Платформа має артефакт для **Renode**, open-source фреймворку симуляції та віртуальної розробки від Antmicro, який постачається разом із `renode-test`, його тестовим раннером на основі Robot Framework, що використовується для інтеграційних тестів симульованої прошивки. Я не запускав його для цієї статті (реліз не вдалося завантажити в моєму середовищі), тому лише переказую те, що сказано в його документації, і не порівнюю його з QEMU. Структура такого тесту та сама, що й вище: справжній ELF, модель апаратної частини, вердикт і код завершення для CI.

## Чек-лист

1. Збирайте тест для **цільової платформи** компілятором цільової платформи й запускайте його в симуляторі, на додачу до ПК.
2. Використовуйте один вихідний код тесту для обох, з тонким шаром (`Platform.h`) для виводу та завершення.
3. Код завершення симулятора — це результат тесту, тож CI більше нічого не потрібно.
4. Використовуйте типи із заданими розміром і знаковістю (`uint32_t`, `uint8_t`) та попередження компілятора цільової платформи: другу помилку вище (`char`) знайшов би `-Wtype-limits`, якби хтось дивився на вивід ARM-збірки.
5. Запишіть, що симулятор довести не може (таймінги, гонки, аналоговий світ), і залиште це апаратним тестам.
