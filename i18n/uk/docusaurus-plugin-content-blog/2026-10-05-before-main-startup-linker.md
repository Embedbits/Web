---
title: "Що відбувається перед main(): скидання, startup-код і linker script"
slug: before-main-startup-linker
date: 2026-10-05T14:00:00
authors: [Mr.Nobody]
tags: [embedded, c, stm32]
---

Кожен підручник із C починається з `int main(void)`. Ніхто не пояснює, хто його викликає. А втім, коли ви пишете `uint32_t counter = 5;` як глобальну змінну і перший рядок `main()` зчитує 5, вже була виконана велика робота. Коли ця робота не виконана, симптом — змінна з випадковим значенням, яка «вчора працювала».

У цій статті ми простежимо шлях мікроконтролера від скидання до першого рядка `main()`: що апаратна частина робить сама, що каже linker script і що має зробити startup-код. Це вміст двох модулів BSP Embedbits ([Linker](/docs/bsp/linker) і [Startup](/docs/bsp/startup)), але принцип той самий на кожному Cortex-M. Увесь код у статті зібрано за допомогою `arm-none-eabi-gcc` 13.2.1 і **запущено** в QEMU на моделі плати STM32F405, тож адреси та виводи справжні.

<!-- truncate -->

## Чого очікує мова C

Стандарт C обіцяє про програму кілька речей, про які апаратна частина не знає:

- глобальна змінна з ініціалізатором (`uint32_t initializedValue = 0x12345678u;`) має це значення на старті,
- глобальна або `static` змінна без ініціалізатора дорівнює **нулю**,
- існує стек, і функція може ним користуватися,
- глобальні об'єкти C++ конструюються (а в C виконуються функції, позначені `__attribute__((constructor))`) до `main()`.

Апаратна частина дає дуже мало. Після скидання ядро Cortex-M робить лише дві речі: зчитує **початкове значення вказівника стека** з першого слова таблиці векторів і **адресу обробника скидання** з другого та переходить туди. Усе інше — робота startup-коду, який є частиною **вашої** прошивки.

## Таблиця векторів

Таблиця векторів — це масив адрес на початку flash (у STM32 це `0x08000000`, що також видно за адресою 0 після завантаження з flash). У мінімальному вигляді вона містить вказівник стека, обробник скидання та обробники винятків:

```c
__attribute__((section(".isr_vector"), used))
void (* const vectorTable[])(void) =
{
    (void (*)(void))&_estack,   /* [0] initial stack pointer */
    Reset_Handler,              /* [1] where the core jumps after the reset */
    NMI_Handler,
    HardFault_Handler,
};
```

Ось що містять перші 16 байтів зібраної прошивки:

```text
Contents of section .isr_vector:
 8000000 00000220 13000008 11000008 11000008
```

Числа записані в порядку little-endian. Перше слово — `0x20020000`, кінець 128 кБ RAM, що починається з `0x20000000`, тобто місце, де починається стек (він росте вниз). Друге — `0x08000013`: обробник скидання розташований за адресою `0x08000012`, а наймолодший біт означає «код Thumb», що обов'язково на Cortex-M. Решта — винятки; усі невикористані я спрямував на один і той самий обробник.

## Linker script: карта пам'яті

Компілятор створює об'єктні файли із секціями (`.text` для коду, `.data`, `.bss` тощо) і не має уявлення, де в пам'яті вони опиняться. Це вирішує лінкер, і йому потрібна карта. Ось увесь скрипт прикладу, 59 рядків:

```text title="link.ld"
/* Entry point: the first instruction that runs after the reset */
ENTRY(Reset_Handler)

MEMORY
{
  FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 1024K
  RAM   (xrw) : ORIGIN = 0x20000000, LENGTH = 128K
}

/* The stack grows down from the end of the RAM */
_estack = ORIGIN(RAM) + LENGTH(RAM);

SECTIONS
{
  /* The vector table has to be at the very beginning of the flash */
  .isr_vector :
  {
    KEEP(*(.isr_vector))
  } > FLASH

  .text :
  {
    *(.text*)
    *(.rodata*)
    . = ALIGN(4);
  } > FLASH

  /* Constructors of the C++ objects and functions marked as constructor */
  .init_array :
  {
    . = ALIGN(4);
    __init_array_start = .;
    KEEP(*(.init_array*))
    __init_array_end = .;
  } > FLASH

  /* Start of the initial values of .data: in the flash, right after the code */
  _sidata = LOADADDR(.data);

  /* .data lives in the RAM (VMA), its initial values are stored in the flash (LMA) */
  .data :
  {
    . = ALIGN(4);
    _sdata = .;
    *(.data*)
    . = ALIGN(4);
    _edata = .;
  } > RAM AT > FLASH

  .bss (NOLOAD) :
  {
    . = ALIGN(4);
    _sbss = .;
    *(.bss*)
    *(COMMON)
    . = ALIGN(4);
    _ebss = .;
  } > RAM
}
```

Прочитаймо важливі частини.

**`MEMORY`** описує фізичні пам'яті: де вони починаються і який мають розмір. Атрибути повідомляють лінкеру, що там дозволено (`rx`: читання та виконання, `xrw`: усе).

**`.isr_vector` іде першою** у flash, а `KEEP` не дає лінкеру її викинути: у коді ніщо не *викликає* таблицю, тож без `KEEP` вона виглядала б невикористаною. Далі йде `.text` з кодом і даними лише для читання (`.rodata`, що означає, що `const`-змінні залишаються у flash і не займають RAM).

**`.data` — найцікавіша.** Подивіться на рядок `} > RAM AT > FLASH`. Кожна секція має дві адреси:

- **VMA** (virtual memory address) — де секція розташована, коли програма *виконується*: `.data` має бути в RAM, бо в неї пишуть,
- **LMA** (load address) — де секція *зберігається* в образі прошивки: після подачі живлення RAM порожня, тож початкові значення мають лежати там, де вони виживають, — у flash.

`arm-none-eabi-objdump -h` показує обидві:

```text
Idx Name          Size      VMA       LMA       File off  Algn
  0 .isr_vector   00000010  08000000  08000000  00001000  2**2
  1 .text         000001b0  08000010  08000010  00001010  2**2
  2 .init_array   00000004  080001c0  080001c0  000011c0  2**2
  3 .data         00000004  20000000  080001c4  00002000  2**2
  4 .bss          00000008  20000004  080001c8  00002004  2**2
```

`.data` розташована за адресою `0x20000000`, але її початкові значення лежать у flash за адресою `0x080001C4`. Хтось має їх скопіювати, і саме тому скрипт визначає символи `_sidata` (джерело у flash), `_sdata` та `_edata` (початок і кінець призначення в RAM). За цими символами немає пам'яті, це лише адреси, які C-код зчитує через `&_sdata`:

```text
080001c4 A _sidata
20000000 D _sdata
20000004 D _edata
20000004 B _sbss
2000000c B _ebss
20020000 R _estack
```

**`.bss` має `NOLOAD`.** В образі вона не має вмісту, лише розмір (змінна без ініціалізатора з нульовим значенням марнувала б flash). Startup-код має заповнити нулями область між `_sbss` та `_ebss`.

**`.init_array`** — це таблиця вказівників на конструктори. Startup-код проходить по ній і викликає їх.

Linker script BSP Embedbits генерується для кожного MCU за допомогою CMake із шаблону. Він має ті самі символи (`_sidata`, `_sdata`, `_edata`, `_sbss`, `_ebss`, `_stack_top`), а також описує необов'язкові регіони, наприклад CCMRAM в STM32G4, куди можна помістити секцію `.ccmram`.

## Startup-код

Скрипт сказав, де що лежить, а тепер код робить те, чого очікує мова C:

```c title="startup.c"
#include <stdint.h>

/* Symbols created by the linker script */
extern uint32_t _sidata, _sdata, _edata, _sbss, _ebss, _estack;
extern void (*__init_array_start[])(void);
extern void (*__init_array_end[])(void);

int main(void);
void Reset_Handler(void);
void Default_Handler(void);

/* A few of the exception handlers, all unused ones point to the default one */
void NMI_Handler(void)       __attribute__((weak, alias("Default_Handler")));
void HardFault_Handler(void) __attribute__((weak, alias("Default_Handler")));

/* The vector table: the first word is the initial stack pointer, the second the reset handler */
__attribute__((section(".isr_vector"), used))
void (* const vectorTable[])(void) =
{
    (void (*)(void))&_estack,
    Reset_Handler,
    NMI_Handler,
    HardFault_Handler,
};

void Reset_Handler(void)
{
#ifdef DEMO_DIRTY_RAM
    /* Only for the demo: RAM full of garbage, as after a reset of a running system.
     * The upper 4 kB are left alone, the stack of this function lives there. */
    for (uint32_t *ramWord = &_sdata; ramWord < (uint32_t *)((uintptr_t)&_estack - 0x1000u); ramWord++)
    {
        *ramWord = 0xA5A5A5A5u;
    }
#endif

#ifndef DEMO_SKIP_INIT
    /* 1. Copy the initial values of .data from the flash to the RAM */
    uint32_t *source = &_sidata;
    for (uint32_t *target = &_sdata; target < &_edata; )
    {
        *target++ = *source++;
    }

    /* 2. Zero the .bss */
    for (uint32_t *target = &_sbss; target < &_ebss; )
    {
        *target++ = 0u;
    }
#endif

    /* 3. Run the constructors */
    for (void (**constructor)(void) = __init_array_start; constructor < __init_array_end; constructor++)
    {
        (*constructor)();
    }

    /* 4. Hand over to the application */
    (void)main();

    for (;;) { }
}

void Default_Handler(void)
{
    for (;;) { }
}
```

`Reset_Handler` має чотири кроки (частини з `#ifdef` призначені для експерименту нижче):

1. **Скопіювати `.data`** з flash (`_sidata`) в RAM (`_sdata` до `_edata`).
2. **Обнулити `.bss`** (`_sbss` до `_ebss`).
3. **Викликати конструктори** з `.init_array`.
4. **Викликати `main()`**. Якщо він колись повернеться, програма залишається в нескінченному циклі, бо повертатися нікуди.

У BSP Embedbits модуль startup, згідно з його документацією, робить трохи більше: він також налаштовує тактування (RCC через MCAL), а потім викликає `AppMain()`. З цього порядку випливає правило: **усе, що виконується до кроків 1 і 2, не повинно торкатися глобальної змінної**, бо її вміст ще недійсний. Налаштування тактування — це функція, що використовує лише регістри, або компілятор тримає її стан у локальних змінних.

## Експеримент: що буде без цього

Застосунок у прикладі має чотири глобальні змінні чотирьох видів:

```c title="main.c"
uint32_t initializedValue = 0x12345678u;       /* .data: has a value in the flash */
uint32_t zeroedValue;                          /* .bss:  has to be zero            */
const uint32_t constantValue = 0xC0FFEE00u;    /* .rodata: stays in the flash      */
uint32_t constructedValue;                     /* set by a constructor before main */

__attribute__((constructor)) static void Construct(void)
{
    constructedValue = 0xC0DE0001u;
}

int main(void)
{
    PrintHex("initializedValue", initializedValue);
    PrintHex("zeroedValue      ", zeroedValue);
    PrintHex("constantValue    ", constantValue);
    PrintHex("constructedValue ", constructedValue);
    PrintHex("address of initializedValue", (uint32_t)&initializedValue);
    PrintHex("address of constantValue   ", (uint32_t)&constantValue);
    Quit();
    return 0;
}
```

(Частина вище, з функціями, що друкують через *semihosting*, — це кілька рядків коду, які просять QEMU надрукувати текст і завершитися. Для теми вона неважлива.)

Спочатку звичайна збірка. Результат:

```text
initializedValue 0x12345678
zeroedValue       0x00000000
constantValue     0xC0FFEE00
constructedValue  0xC0DE0001
address of initializedValue 0x20000000
address of constantValue    0x080001BC
```

Усі чотири значення такі, як обіцяє мова C, а адреси підтверджують історію: змінна в RAM розташована за `0x2000...`, константа у flash — за `0x0800...`.

Тепер експеримент. Після скидання працюючої системи RAM не порожня: вона містить те, що там було раніше. Холодний старт MCU часто «щасливий», бо RAM випадково нульова, і тоді помилка в startup-коді довго залишається прихованою. Для тесту я «забруднив» RAM (`-DDEMO_DIRTY_RAM` заповнює її `0xA5A5A5A5` перед усім іншим), а потім прибрав кроки 1 і 2 (`-DDEMO_SKIP_INIT`):

```bash
arm-none-eabi-gcc -mcpu=cortex-m4 -mthumb -Os -ffreestanding -nostartfiles \
    -T link.ld -DDEMO_DIRTY_RAM -DDEMO_SKIP_INIT startup.c main.c -o broken.elf
qemu-system-arm -M netduinoplus2 -nographic \
    -semihosting-config enable=on,target=native -kernel broken.elf
```

```text
initializedValue 0xA5A5A5A5
zeroedValue       0xA5A5A5A5
constantValue     0xC0FFEE00
constructedValue  0xC0DE0001
```

Подивіться, що не так, а що так:

- `initializedValue` і `zeroedValue` — сміття. Перша не має початкового значення, друга не нульова, хоча обидва рядки в C-файлі стверджують інше.
- `constantValue` у порядку, бо вона у flash, і її нікому не потрібно копіювати.
- `constructedValue` у порядку, бо конструктор записав її *після* (відсутньої) ініціалізації. Ось чому цей вид помилок так важко знайти: одна половина програми працює, а друга має випадкові значення.

З брудною RAM і повним startup-кодом та сама програма знову друкує правильні значення.

## Як це виглядає в реальному житті

Кілька симптомів і те, що зазвичай за ними стоїть:

| Симптом | Імовірна причина |
|---|---|
| Програма потрапляє в hard fault одразу після скидання | Перше слово таблиці векторів не є дійсною адресою стека (неправильний `_estack`, неправильний розмір RAM) або таблиця не на початку flash |
| Глобальна змінна з ініціалізатором має неправильне значення, і та, що з `= 0`, також | `.data` не скопійовано або `.bss` не обнулено (неправильний символ, секція, якої немає в скрипті) |
| Працює після подачі живлення і ламається після скидання | Те саме, при подачі живлення RAM випадково була порожньою |
| Дивне значення, що змінюється разом з розміром коду | Стек росте вниз до `.bss` / `.data`, переповнення стека |
| Перший `printf` або драйвер не працює | Код, що виконується до кроків 1 і 2, використовує глобальну змінну |

### Що кажуть вам числа інструмента

```text
   text	   data	    bss	    dec	    hex	filename
    448	      8	      8	    464	    1d0	good.elf
```

- **Flash** = `text` + `data`. Початкові значення `.data` також займають місце у flash, тож великий ініціалізований масив коштує вам вдвічі: у flash і в RAM. Масив, який не змінюється, має бути `const`, і тоді він лише у flash.
- **RAM** = `data` + `bss` (+ стек і купа).

Лінкер також може перевірити це за вас: `-Wl,--print-memory-usage` друкує, скільки кожного регіону використано:

```text
Memory region         Used Size  Region Size  %age Used
           FLASH:         456 B         1 MB      0.04%
             RAM:          12 B       128 KB      0.01%
```

Додайте цей прапорець до своєї збірки й читайте файл `.map` (`-Wl,-Map,out.map`), коли щось опиняється в несподіваному місці: він містить адресу кожної функції та кожної змінної.

## Підсумок

1. Після скидання ядро зчитує два слова: вказівник стека й адресу обробника скидання. Усе інше — ваш код.
2. **Linker script** — це карта: де пам'яті, в якому порядку лежать секції та які символи позначають їхні межі.
3. **Startup-код** робить обіцянки мови правдою: він копіює `.data`, обнуляє `.bss`, запускає конструктори і викликає `main()`.
4. Змінна, яка має значення у flash і живе в RAM, має дві адреси: адресу завантаження та адресу виконання. Це ключ до всієї теми.
5. Тримайте `-Wl,--print-memory-usage` увімкненим і читайте `arm-none-eabi-size` та map-файл. Вони розкажуть вам про те, куди поділася ваша пам'ять, більше за налагоджувач.

У BSP Embedbits ви не пишете ці два файли самі: linker script генерується для вибраного MCU, а startup-код постачається з гілкою BSP для сімейства. Але розуміти, що вони роблять, усе одно варто, бо коли прошивка не стартує, ніхто інший вам не допоможе.
