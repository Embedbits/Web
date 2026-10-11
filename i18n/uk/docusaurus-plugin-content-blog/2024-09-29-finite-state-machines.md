---
title: "Скінченні автомати"
slug: finite-state-machines
date: 2024-09-29T16:24:40
authors: [Mr.Nobody]
tags: [embedded]
image: /img/blog/fsm-state-machine.png
---

Для розробки embedded-програмного забезпечення необхідний належний дизайн. Мікроконтролер має обробляти сам застосунок і спілкуватися з безліччю підключених схем через внутрішню або зовнішню периферію. Виконання застосунку має бути якомога швидшим. Але це справді жахливе пояснення для будь-кого. У реальному світі розробник має забезпечити оптимально короткий логічний шлях виконання коду. Це означає, що розробник не повинен перевіряти всі умови в кожному головному циклі. Один зі способів такої оптимізації — правильне вкладення умов. З ростом складності проєкту це може бути справді непросто. Велика кількість вкладених умовних операторів може призвести до нестабільності коду та погіршити його читабельність. Читабельність коду жорстоко необхідна для майбутніх оновлень або супроводу наявного коду. Одна з моїх улюблених цитат каже:

<!-- truncate -->

![Фрагмент таблиці підпрограм автомата станів на C](/img/blog/fsm-state-machine.png)

> **Завжди пишіть код так, ніби той, хто в підсумку супроводжуватиме ваш код, — агресивний психопат, який знає, де ви живете.**

Тож нам краще подумати, перш ніж писати власне код. Цей процес називається «дизайн», і він мені дуже подобається. Бо якщо робити його правильно, обсяг нового коду та подальшого редагування цього нового коду справді скорочується. Іноді може здаватися, що це забирає багато часу, але насправді цей час разом із часом написання коду коротший, ніж написання коду, який доведеться постійно переписувати. Але як це полегшити? Тут можна почати говорити про скінченні автомати (Finite State Machines), також відомі як FSM.

Тож почнімо з безглуздого опису, згенерованого ШІ:

> Автомати станів, зокрема автомати Мілі та Мура, є фундаментальними моделями в проєктуванні цифрових систем і теорії обчислень. Обидва ці автомати використовуються для представлення систем, які переходять між різними станами залежно від вхідних даних і в результаті видають вихідні дані. Проте саме спосіб формування виходу відрізняє їх одне від одного.
>
>
>
>
>
>
>
> **Автомат Мілі** формує вихід залежно і від **поточного стану**, і від **поточного входу**. Це робить автомати Мілі чутливішими, адже вихід може динамічно змінюватися з кожним вхідним сигналом.
>
>
>
>
>
>
>
> З іншого боку, **автомат Мура** формує вихід виключно залежно від свого **поточного стану**, незалежно від входу. Це робить автомати Мура простішими та передбачуванішими, адже вихід залишається незмінним, доки не зміниться стан.
>
>
>
>
>
>
>
> Ці автомати станів широко застосовуються у вбудованих системах, системах керування та цифрових схемах, де критичні точні переходи між станами та виходи. У цьому блозі ми розглянемо, як працюють автомати Мілі та Мура, їхні ключові відмінності та як їх можна застосувати в практичному проєктуванні систем.

Але що це означає? Простими словами, скінченний автомат Мілі перевіряє умови для потрібного стану ***перед*** виконанням поточного стану. Автомат Мура перевіряє умови ***після*** виконання поточного стану.

Але що таке стан? Уявіть лампочку, яку можна вмикати й вимикати натисканням кнопки. Для обробки такої поведінки нашому автомату потрібні лише два стани. Один стан, що активує виконавчий пристрій, і другий стан, що цей пристрій деактивує. Справді просто, чи не так? А що в складних системах? Що ж, вам потрібна проста реалізація, придатна для різних ситуацій. Саме це робить шаблон нижче.

Під час роботи в автомобільній галузі ми з моїм колегою [Яном Сімою](https://www.linkedin.com/in/jano-sima/) зіткнулися з проблемами в дизайні скінченних автоматів. Було безліч різних стилів, але жоден не мав достатньої функціональності, щоб досягти стабільності та чистого дизайну. Тож ми вирішили розробити власний шаблон. З дозволу Яна я публікую шаблон нашого скінченного автомата під ліцензією MIT.


## Завантажте шаблон

Шаблон опубліковано під ліцензією MIT. Усе є звичайним текстом, тож ви можете прочитати його перед завантаженням:

| Файл | Що це |
| --- | --- |
| [FsmTemplate.c](pathname:///downloads/fsm/FsmTemplate.c) | Шаблон на **C** (C99), один файл зі станами, таблицею підпрограм і заглушками |
| [FsmTemplate.hpp](pathname:///downloads/fsm/FsmTemplate.hpp) і [FsmTemplate.cpp](pathname:///downloads/fsm/FsmTemplate.cpp) | Шаблон на **C++** (C++17), клас з одним автоматом станів усередині |
| [Fsm.hpp](pathname:///downloads/fsm/Fsm.hpp) | Header-only рушій для версії на C++ (без heap, без винятків, без RTTI) |
| [fsm-instantiate.sh](pathname:///downloads/fsm/fsm-instantiate.sh) | Невеликий скрипт, що замінює назви, `fsm-instantiate.sh Button FsmTemplate.c src/` створює `src/Button.c` |

Назви в кутових дужках замінюються назвою вашого модуля: `<Module>` стає `Button`, `<module>` стає `button`, а `<MODULE>` стає `BUTTON`.

## Як це працює

Це автомат Мура. Кожен стан має чотири підпрограми, і автомат викликає їх в однаковому порядку при кожному запуску:

1. **Entry**: викликається один раз, коли стан входить в дію.
2. **Execute**: викликається при кожному запуску, тут виконується робота стану.
3. **CheckLeave**: викликається при кожному запуску після Execute. Це **єдине** місце, де запитується новий стан.
4. **Leave**: викликається один раз, коли стан залишається.

Увесь рушій — це одна функція. Це версія на C:

```c
static void <Module>_HandleStateTransition(void)
{
    /* A corrupted actual state must not index outside of the table: start again from the default state. */
    if (<MODULE>_STATE_COUNT <= <module>_SM_ActualState)
    {
        <module>_SM_ActualState = <MODULE>_STATE_1;
        <module>_SM_NewState    = <MODULE>_STATE_1;

        <Module>_CallRoutine(<module>_SM_StateRoutines[<module>_SM_ActualState].entry);
    }
    else
    {
        /* Actual state is in the valid range */
    }

    /* Execute function shall be used for main execution of actual state */
    <Module>_CallRoutine(<module>_SM_StateRoutines[<module>_SM_ActualState].execute);

    /* CheckLeave function shall be used for check leave condition of actual state */
    <Module>_CallRoutine(<module>_SM_StateRoutines[<module>_SM_ActualState].checkLeave);

    /* In case of an invalid request (made in checkLeave), switch to the default/error state. */
    if (<MODULE>_STATE_COUNT <= <module>_SM_NewState)
    {
        <module>_SM_NewState = <MODULE>_STATE_1;
    }
    else
    {
        /* Requested state is in the valid range */
    }

    /* Leave and entry functions shall be executed only in case if the state has to be changed to another state */
    if (<module>_SM_ActualState != <module>_SM_NewState)
    {
        <Module>_CallRoutine(<module>_SM_StateRoutines[<module>_SM_ActualState].leave);

        <module>_SM_ActualState = <module>_SM_NewState;

        <Module>_CallRoutine(<module>_SM_StateRoutines[<module>_SM_ActualState].entry);
    }
    else
    {
        /* No new state required */
    }
}
```

Оскільки перехід запитується лише в `CheckLeave`, вхід у стан і вихід із нього виконуються завжди як пара, у відомому порядку, а виходи залежать лише від стану. Непотрібна підпрограма може бути `NULL` (`nullptr` у C++), і її буде пропущено.

## Що було виправлено {#what-was-fixed}

Перша версія шаблону, яку я тут опублікував, мала кілька помилок. Я пройшов по ній ще раз, зібрав її та запустив із тестом, що записує порядок викликів. Ось зміни:

- Початкове значення змінних стану було залишком назви з іншого проєкту (`APPCORE_HANDLER_STATE_1` замість `<MODULE>_STATE_1`).
- В останньому рядку таблиці стояло `State_2_Leave` замість `State_3_Leave`. Код компілювався й викликав неправильну підпрограму при виході з третього стану. Тепер таблиця індексується станом (`[<MODULE>_STATE_3] = { ... }`), тож позицію рядка переплутати неможливо.
- `Init` не запускав підпрограму entry першого стану.
- Номери станів не перевірялися. Пошкоджений поточний стан або запит неіснуючого стану індексували за межами таблиці. Тепер перевіряються обидва, і автомат повертається до першого стану, який є безпечним. Запит перевіряється **після** `CheckLeave`, бо саме там він робиться. Моє перше виправлення перевіряло його до цього, і тест це виявив, що є гарним доказом того, чому такий тест вартий зусиль.
- Підпрограма з вказівником `NULL` пропускається замість аварії.
- Відсутнє попереднє оголошення (forward declaration) і коментар у заголовку, що після заміни назв перетворився на нісенітницю.

## Версія на C++

У C++ той самий шаблон — це клас. Стан — `enum class`, підпрограми — приватні функції-члени, а таблиця — `constexpr`:

```cpp
class Button
{
public:
    enum class State : std::uint8_t { Idle = 0u, Pressed, Count };

    void Init() noexcept;
    void Task() noexcept;
    State GetState() const noexcept { return stateMachine.GetState(); }

private:
    using Machine = fsm::StateMachine<Button, State, static_cast<std::size_t>(State::Count)>;

    void IdleEntry();   void IdleExecute();   void IdleCheckLeave();   void IdleLeave();
    void PressedEntry(); /* ... */

    static constexpr Machine::Table MakeTable() noexcept;
    static const Machine::Table table;
    Machine stateMachine;
};
```

Запит — це `stateMachine.RequestState(State::Pressed)` у підпрограмі `CheckLeave`. Рядок таблиці має належати своєму стану, і це перевіряється **під час компіляції** за допомогою `static_assert`, тож помилка з першої версії просто не збереться. Немає heap, винятків і RTTI, тож це відповідає звичним embedded- та MISRA-подібним обмеженням. Версію на C++ скомпільовано з `-Wall -Wextra -Wconversion -pedantic -fno-exceptions -fno-rtti` і запущено під санітайзерами address та undefined behavior з тими самими сценаріями, що й версію на C: порядок викликів, запит, недійсний запит, пошкоджений стан і пропущені підпрограми `NULL`.

Друга частина цієї серії, [кнопка з debounce та довгим натисканням](/blog/fsm-in-practice-button), показує шаблон у реальному модулі.

## Ліцензія

```text
Copyright (c) 2024 Marek Petrinec, Jan Sima

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
