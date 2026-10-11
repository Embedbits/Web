---
title: "Скінченні автомати на практиці: кнопка з debounce та довгим натисканням"
slug: fsm-in-practice-button
date: 2026-10-06T10:00:00
authors: [Mr.Nobody]
tags: [embedded, c, architecture]
---

У [першій статті про скінченні автомати](/blog/finite-state-machines) я дав вам шаблон і закінчив словами «далі буде». Це продовження, а найкращий спосіб продовжити теорію — це задача. Я обрав ту, що є в кожному embedded-проєкті і яку ніхто не робить правильно з першого разу: **кнопка**.

Кнопка виглядає тривіальною: пін, високий або низький рівень. Але механічний контакт *деренчить* (bounce), тож пін робить 1 0 1 1 0 1, перш ніж заспокоїться, а продукт зазвичай хоче від тієї самої кнопки двох різних речей: коротке і довге натискання. Якщо написати це з прапорцями та лічильниками в головному циклі, вийде кілька `if`, що залежать один від одного так, що за місяць ніхто не зможе пояснити як. Скінченний автомат вирішує це так, що пояснити можна таблицею.

<!-- truncate -->

## Шаблон в одному абзаці

Кожен стан має чотири підпрограми, і кожна з них має рівно одне завдання:

| Підпрограма | Коли викликається | Завдання |
|---|---|---|
| `Entry` | один раз, коли стан входить в дію | підготувати стан (скинути лічильник, створити подію) |
| `Execute` | при кожному запуску автомата, поки він у цьому стані | виконати роботу стану (рахувати, семплювати) |
| `CheckLeave` | при кожному запуску, після `Execute` | вирішити, чи залишати стан і куди переходити: **єдине місце, де запитується перехід** |
| `Leave` | один раз, коли стан залишається | прибрати за собою |

Ядро автомата запускає `Execute` і `CheckLeave` поточного стану, а коли стан змінився, запускає `Leave` старого і `Entry` нового. Підпрограми ніколи не викликають одна одну, а код автомата не містить нічого, крім автомата. Якщо хочете знати, чому пристрій у певному стані, читайте `CheckLeave` попереднього.

## Спочатку дизайн: стани та переходи

Задача запускається кожні 10 мс і читає сирий контакт. Час debounce — 50 мс, а межа довгого натискання — 1 секунда. П'яти станів достатньо:

| Стан | Execute | Залишається, коли | Куди |
|---|---|---|---|
| `RELEASED` | нічого | контакт замкнений | `DEBOUNCE_PRESS` |
| `DEBOUNCE_PRESS` | рахує тики | контакт знову розімкнувся (це був збій) | `RELEASED` |
| | | контакт був замкнений 50 мс | `PRESSED` |
| `PRESSED` | рахує тики | контакт розмикається: подія **короткого натискання** | `DEBOUNCE_RELEASE` |
| | | контакт замкнений 1 с | `LONG_PRESS` |
| `LONG_PRESS` | нічого, подію **довгого натискання** створено на вході | контакт розмикається | `DEBOUNCE_RELEASE` |
| `DEBOUNCE_RELEASE` | рахує тики розімкненого контакту, деренчання скидає лічильник | контакт був розімкнений 50 мс | `RELEASED` |

Складання таблиці — це справжня робота. Коли вона повна, код — лише вправа з друкування. Коли ні (що відбувається в `LONG_PRESS`, коли контакт деренчить при відпусканні?), таблиця покаже діру ще до того, як ви напишете рядок C.

## Код

Вхід приходить із BSP, тож модуль не має апаратних залежностей і його можна тестувати на ПК (той самий *seam*, що й у статті про [unit-тестування](/blog/unit-testing-unity-cmock)). Порт модуля — це `Init`, `Task` і функція, що повертає подію один раз:

```c title="Button_Port.h"
#ifndef BUTTON_BUTTON_PORT_H
#define BUTTON_BUTTON_PORT_H

typedef enum
{
    BUTTON_EVENT_NONE = 0u,
    BUTTON_EVENT_SHORT_PRESS,
    BUTTON_EVENT_LONG_PRESS
}   button_Event_t;

void           Button_Init(void);
void           Button_Task(void);          /* call it every 10 ms */
button_Event_t Button_Get_Event(void);     /* returns the event once and clears it */

#endif
```

Типи слідують шаблону. Є одна зміна, яку я зробив навмисно: таблиця підпрограм **індексується станом**, а не обшукується, і перелік закінчується `BUTTON_STATE_COUNT`, який має два застосування.

```c title="Button.c"
typedef enum
{
    BUTTON_STATE_RELEASED = 0u,    /**< Contact open, waiting for a press      */
    BUTTON_STATE_DEBOUNCE_PRESS,   /**< Contact closed, is it stable?          */
    BUTTON_STATE_PRESSED,          /**< Stable press, short or long?           */
    BUTTON_STATE_LONG_PRESS,       /**< Held longer than the limit             */
    BUTTON_STATE_DEBOUNCE_RELEASE, /**< Contact open again, is it stable?      */
    BUTTON_STATE_COUNT             /**< Number of the states, keep it the last */
}   button_SM_States_t;

typedef void (*button_SM_PtrToRoutine_t)(void);

typedef struct
{
    button_SM_PtrToRoutine_t entry;
    button_SM_PtrToRoutine_t execute;
    button_SM_PtrToRoutine_t checkLeave;
    button_SM_PtrToRoutine_t leave;
}   button_SM_Routines_t;
```

Перше застосування — сама таблиця. З designated initializers позиція рядка не має значення, тож стан не можна прив'язати до неправильних підпрограм, коли хтось додасть рядок посередині (шаблон потребує коментаря «цей масив має мати той самий порядок, що й enum станів»):

```c title="Button.c"
/* The table is indexed by the state, so the order of the lines does not matter. */
static const button_SM_Routines_t stateRoutines[BUTTON_STATE_COUNT] =
{
    [BUTTON_STATE_RELEASED]         = { Button_Released_Entry,        Button_Released_Execute,
                                        Button_Released_CheckLeave,   Button_Released_Leave        },
    [BUTTON_STATE_DEBOUNCE_PRESS]   = { Button_DebouncePress_Entry,   Button_DebouncePress_Execute,
                                        Button_DebouncePress_CheckLeave, Button_DebouncePress_Leave },
    [BUTTON_STATE_PRESSED]          = { Button_Pressed_Entry,         Button_Pressed_Execute,
                                        Button_Pressed_CheckLeave,    Button_Pressed_Leave         },
    [BUTTON_STATE_LONG_PRESS]       = { Button_LongPress_Entry,       Button_LongPress_Execute,
                                        Button_LongPress_CheckLeave,  Button_LongPress_Leave       },
    [BUTTON_STATE_DEBOUNCE_RELEASE] = { Button_DebounceRelease_Entry, Button_DebounceRelease_Execute,
                                        Button_DebounceRelease_CheckLeave, Button_DebounceRelease_Leave },
};
```

Друге застосування — ядро автомата, в якому та сама константа замінює жорстко закодований «останній стан» у перевірці діапазону:

```c title="Button.c"
static void Button_HandleStateTransition(void)
{
    if (BUTTON_STATE_COUNT <= newState)
    {
        newState = BUTTON_STATE_RELEASED;      /* invalid request: go to the safe state */
    }

    stateRoutines[actualState].execute();
    stateRoutines[actualState].checkLeave();

    if (actualState != newState)
    {
        stateRoutines[actualState].leave();
        actualState = newState;
        stateRoutines[actualState].entry();
    }
}
```

Зверніть увагу, чого ядро *не знає*: кнопок, часу, подій. Тепер стани. Більшість підпрограм — однорядкові:

```c title="Button.c"
/* ---- RELEASED ---- */
static void Button_Released_Entry(void)      { stateTicks = 0u; }
static void Button_Released_Execute(void)    { }
static void Button_Released_CheckLeave(void) { if (isContactClosed) { newState = BUTTON_STATE_DEBOUNCE_PRESS; } }
static void Button_Released_Leave(void)      { }

/* ---- DEBOUNCE_PRESS: closed, but is it only a bounce? ---- */
static void Button_DebouncePress_Entry(void)      { stateTicks = 0u; }
static void Button_DebouncePress_Execute(void)    { stateTicks++; }
static void Button_DebouncePress_CheckLeave(void)
{
    if (!isContactClosed)
    {
        newState = BUTTON_STATE_RELEASED;               /* a glitch, nothing happened */
    }
    else if (BUTTON_DEBOUNCE_TICKS <= stateTicks)
    {
        newState = BUTTON_STATE_PRESSED;
    }
}
static void Button_DebouncePress_Leave(void)      { }

/* ---- PRESSED: a short press if released early, a long one if held ---- */
static void Button_Pressed_Entry(void)      { stateTicks = 0u; }
static void Button_Pressed_Execute(void)    { stateTicks++; }
static void Button_Pressed_CheckLeave(void)
{
    if (!isContactClosed)
    {
        pendingEvent = BUTTON_EVENT_SHORT_PRESS;
        newState     = BUTTON_STATE_DEBOUNCE_RELEASE;
    }
    else if (BUTTON_LONG_PRESS_TICKS <= stateTicks)
    {
        newState = BUTTON_STATE_LONG_PRESS;
    }
}
static void Button_Pressed_Leave(void)      { }

/* ---- LONG_PRESS: the event is created once, on the entry ---- */
static void Button_LongPress_Entry(void)      { pendingEvent = BUTTON_EVENT_LONG_PRESS; }
static void Button_LongPress_Execute(void)    { }
static void Button_LongPress_CheckLeave(void) { if (!isContactClosed) { newState = BUTTON_STATE_DEBOUNCE_RELEASE; } }
static void Button_LongPress_Leave(void)      { }

/* ---- DEBOUNCE_RELEASE: open, has to stay open for the debounce time ---- */
static void Button_DebounceRelease_Entry(void)      { stateTicks = 0u; }
static void Button_DebounceRelease_Execute(void)    { stateTicks = isContactClosed ? 0u : (uint16_t)(stateTicks + 1u); }
static void Button_DebounceRelease_CheckLeave(void) { if (BUTTON_DEBOUNCE_TICKS <= stateTicks) { newState = BUTTON_STATE_RELEASED; } }
static void Button_DebounceRelease_Leave(void)      { }
```

Кілька деталей, на які варто глянути:

- `Button_Task()` читає вхід **один раз** за запуск і зберігає його в `isContactClosed`. Усі підпрограми одного запуску бачать те саме значення, навіть якщо пін змінюється посеред запуску.
- Подія короткого натискання створюється в `Button_Pressed_CheckLeave()`, у тому самому місці, де ухвалюється рішення. Подія довгого натискання створюється в `Button_LongPress_Entry()`: entry викликається рівно один раз на перехід, тож подія не може бути створена двічі, що б не робив контакт, поки кнопка утримується.
- Debounce відпускання (`DEBOUNCE_RELEASE`) скидає свій лічильник щоразу, коли контакт знову замикається. Це відповідь на деренчання при відпусканні: автомат чекає, доки контакт не вгамується на 50 мс.

## Тест

Тест замінює `Bsp_Get_ButtonRaw()` функцією, що читає рядок: один символ на тик у 10 мс, `1` — замкнений контакт. Шаблони — це історія кнопки, а результат — рядок подій, `S` для короткого натискання і `L` для довгого:

```c title="test_Button.c"
/* The fake input: one character per 10 ms tick, '1' = contact closed. */
static const char *inputPattern;
static size_t      inputIndex;

bool Bsp_Get_ButtonRaw(void)
{
    const char symbol = inputPattern[inputIndex];
    if ('\0' != symbol) { inputIndex++; }
    return ('1' == symbol);
}

/* Runs the machine over the whole pattern and returns the events as a string, S = short, L = long. */
static const char *Run(const char *pattern)
{
    static char events[16];
    size_t count = 0u;

    inputPattern = pattern;
    inputIndex   = 0u;
    memset(events, 0, sizeof events);
    Button_Init();

    for (size_t tick = 0u; tick < strlen(pattern) + 20u; tick++)   /* 20 extra ticks of an open contact */
    {
        Button_Task();
        const button_Event_t event = Button_Get_Event();
        if (BUTTON_EVENT_SHORT_PRESS == event) { events[count++] = 'S'; }
        if (BUTTON_EVENT_LONG_PRESS  == event) { events[count++] = 'L'; }
    }
    return events;
}

static void Expect(const char *name, const char *pattern, const char *expected)
{
    const char *result = Run(pattern);
    printf("%-34s -> %s\n", name, ('\0' == result[0]) ? "(no event)" : result);
    assert(0 == strcmp(expected, result));
}

int main(void)
{
    char longHold[220];

    Expect("nothing happens",                 "0000000000",                              "");
    Expect("a 20 ms glitch",                  "0011000000",                              "");
    Expect("a clean 200 ms press",            "00111111111111111111110000000000",        "S");
    Expect("a press with a bouncing contact", "0101101111111111111111011010000000000",   "S");
    Expect("a bounce on the release",         "001111111111111111111101001000000000",    "S");

    memset(longHold, '1', 150u); longHold[150] = '\0';       /* 1.5 s */
    Expect("a 1.5 s hold",                    longHold,                                  "L");

    memset(longHold, '1', 99u);  longHold[99] = '\0';        /* just under the limit (+ debounce) */
    Expect("a 0.99 s hold",                   longHold,                                  "S");

    puts("all state machine tests passed");
    return 0;
}
```

Вивід запуску — справжній:

```text
nothing happens                    -> (no event)
a 20 ms glitch                     -> (no event)
a clean 200 ms press               -> S
a press with a bouncing contact    -> S
a bounce on the release            -> S
a 1.5 s hold                       -> L
a 0.99 s hold                      -> S
all state machine tests passed
```

Два останні рядки — це випадок, який прапорці завжди обробляють неправильно. Утримання 1,5 секунди дає **одне** довге натискання і жодного короткого після відпускання, а утримання трохи менше за межу — це коротке натискання. Обидва результати випливають із таблиці, а не з ретельного програмування.

## Що ви отримуєте і чого це коштує

**Ви отримуєте:**

- **читабельну специфікацію**: таблиця вище і код — це одне й те саме,
- **гарантію «рівно один раз»**: `Entry` і `Leave` виконуються по одному разу на перехід, події не дублюються,
- **місце для всього**: нова вимога (подвійний клік) — це новий стан або новий рядок у таблиці, а не правка трьох вкладених умов,
- **автомат, який можна тестувати на ПК** з рядком як входом, як ви щойно бачили.

**Це коштує:**

- **шаблонний код (boilerplate)**: чотири функції на стан, більшість із них порожні. Це плата за однорідність, і вона окупається з 5-м станом. Для автомата з двома станами краще `switch`,
- **таблицю переходів треба продумати** до написання коду. Це не витрата, але на початку так здається.

## Підводні камені

1. **Час належить періоду задачі, а не затримці.** Автомат рахує запуски, тож межі (50 мс, 1 с) — це кількість тиків. Ніколи не викликайте затримку в стані, вона блокує всі інші автомати.
2. **Семплуйте в задачі, а не в перериванні.** Переривання піна бачило б кожне деренчання. Задача, що запускається кожні 10 мс, — це безкоштовний фільтр низьких частот.
3. **Єдиний слот для події губить події,** якщо застосунок читає її повільніше, ніж автомат створює. Для кнопки це не має значення, для протоколу має: використовуйте чергу.
4. **Недійсний стан — це теж стан.** Перевірка діапазону в ядрі відправляє пошкоджену змінну в безпечний стан замість читання таблиці за її межами (тут діють правила MISRA про [undefined behavior](/blog/misra-c-rules-in-practice)).
5. **Автомат із 30 станами — ознака відсутньої ієрархії.** Розділіть його на кілька автоматів, де один є *станом* іншого, і тримайте кожен достатньо малим, щоб він умістився в таблицю на одному екрані.

## Виправлення в шаблоні

Коли я порівняв приклад із шаблоном із першої статті, я знайшов у шаблоні дві помилки й виправив їх там (пізніша перевірка шаблону знайшла ще, див. [перелік виправлень](/blog/finite-state-machines#what-was-fixed)): початкове значення змінних стану було залишком назви з іншого проєкту (`APPCORE_HANDLER_STATE_1` замість `<MODULE>_STATE_1`), а в останньому рядку таблиці стояло `State_2_Leave` замість `State_3_Leave`. Друга — це той тип помилки, якому присвячена ця стаття: код компілюється, а автомат викликає неправильну підпрограму при виході з третього стану. Таблиця з designated initializers трохи ускладнює таку помилку, а тест, що проходить усі стани, робить її неможливою.
