---
title: "Проєктування API периферії: вісім рішень за модулем Gpio"
slug: designing-peripheral-api-gpio
date: 2026-10-07T10:00:00
authors: [Mr.Nobody]
tags: [embedded, c, architecture]
---

GPIO — найпростіша периферія мікроконтролера: пін має високий або низький рівень. Саме тому це добра тема для статті про **проєктування інтерфейсу**. Тут немає апаратної складності, за якою можна сховатися, і кожне рішення — це вибір проєктувальника: як називається пін, що повертає функція, де живе полярність світлодіода. MCAL-модуль `Gpio` з BSP від Embedbits — реальний приклад із реальними відповідями, і я пройдуся по них одну за одною, з альтернативами та ціною.

Код модуля цитується з гілки STM32H5 репозиторію [Bsp-Mcal-Gpio](https://github.com/Embedbits/Bsp-Mcal-Gpio). Приклади, що його використовують, були скомпільовані та запущені з **справжніми** `Gpio_Port.h` і `Gpio_Types.h` та невеликою заглушкою реалізації, щоб API можна було спробувати на ПК.

<!-- truncate -->

## Увесь інтерфейс на одному екрані

```c
gpio_ModuleVersion_t Gpio_Get_ModuleVersion  ( void );

gpio_RequestState_t  Gpio_Init               ( gpio_Config_t *gpioConfig );
void                 Gpio_Deinit             ( void );
void                 Gpio_Task               ( void );

gpio_RequestState_t  Gpio_Set_PortActive     ( gpio_PortId_t portId );
gpio_RequestState_t  Gpio_Set_PinMode        ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinMode_t pinType );
gpio_RequestState_t  Gpio_Get_PinMode        ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinMode_t * const pinType );
/* ... speed, output type, alternate function and pull in the same pairs ... */

gpio_RequestState_t  Gpio_Toggle_PinLevel    ( gpio_PortId_t portId, gpio_PinId_t pinId );
gpio_RequestState_t  Gpio_Set_PinLevel       ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinLevel_t pinLevel );
gpio_RequestState_t  Gpio_Get_PinLevel       ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinLevel_t * const pinLevel );

gpio_RequestState_t  Gpio_Set_PinStateActive   ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinLevel_t pinActiveLevel );
gpio_RequestState_t  Gpio_Set_PinStateInactive ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinLevel_t pinActiveLevel );
```

Кожне рішення нижче можна прочитати з цього переліку.

## 1. Пін — це пара ідентифікаторів, а не макрос вендора

Драйвери вендора адресують пін за допомогою вказівника на блок регістрів і бітової маски: `LL_GPIO_SetOutputPin(GPIOA, LL_GPIO_PIN_5)`. Натомість MCAL приймає два переліки, `gpio_PortId_t` і `gpio_PinId_t`:

```c
Gpio_Set_PinLevel( GPIO_PORT_A, GPIO_PIN_ID_5, GPIO_PIN_LEVEL_HIGH );
```

**Чому:** код над MCAL не потребує жодного заголовка вендора, він не знає, що таке `GPIOA` (адреса блоку регістрів вендора), а ідентифікатор можна перевірити на діапазон, чого не можна зробити з довільним вказівником. Кожен перелік закінчується лічильником (`GPIO_PORT_CNT`, `GPIO_PIN_ID_CNT`), який є верхньою межею для перевірки на початку функції.

**Ціна:** таблиця, що перетворює ідентифікатор на блок регістрів (у `Gpio.c`, один рядок на порт), і ще один рівень непрямості. Таблиця також розв'язує власну проблему: MCU одного сімейства мають різну кількість портів, тож записи загорнуто в `#if defined(GPIOK)` (див. статтю про [сімейства](/blog/bsp-stm32-families-git-branches)).

## 2. Кожна функція, що може зазнати невдачі, повертає стан, а результати виходять через вказівник

Усі функції, окрім `Deinit`, `Task` і геттера версії, повертають `gpio_RequestState_t`, а геттери передають значення через параметр-вказівник:

```c
gpio_PinLevel_t level = GPIO_PIN_LEVEL_LOW;

if (GPIO_REQUEST_OK == Gpio_Get_PinLevel(GPIO_PORT_C, GPIO_PIN_ID_13, &level))
{
    /* level is valid here */
}
```

**Чому:** значення, що повертає геттер, не може нести і значення, *і* інформацію про те, що значення недійсне (`GPIO_PIN_LEVEL_LOW` — дійсний рівень, тож повернений `0` неоднозначний). Зі станом у поверненому значенні та даними в параметрі недійсний порт, недійсний пін чи вказівник `NULL` — це помітна помилка, а не мовчки хибний рівень. `* const` у сигнатурі говорить, що функція не змінює вказівник, лише дані за ним.

**Ціна:** два рядки замість одного при кожному використанні. А стан має два значення (`GPIO_REQUEST_OK`, `GPIO_REQUEST_ERROR`), тож викликач знає, *що* сталася помилка, але не *чому*. Для GPIO цього достатньо, бо причин лише кілька (недійсний ідентифікатор, `NULL`), і всі вони — помилки програмування. Для периферії з реальними збоями (тайм-аут I2C, помилка шини) викликачеві потрібно більше, і звичайна відповідь — багатший перелік.

Правило з статті про [MISRA](/blog/misra-c-rules-in-practice), яке тут діє, — 17.7 (повернене значення використовується): інтерфейс полегшує його дотримання, бо кожна функція, що може зазнати невдачі, повідомляє про це значенням, на яке треба подивитися.

## 3. Пін налаштовується даними, а не послідовністю викликів

Є структура конфігурації з усім, що описує пін, і одна функція, яка її застосовує:

```c
typedef struct
{
    gpio_PortId_t        PortId;         /**< GPIO port identification       */
    gpio_PinId_t         PinId;          /**< GPIO pin identification        */
    gpio_PinMode_t       PinMode;        /**< GPIO pin type                  */
    gpio_PinPullCfg_t    PinPull;        /**< GPIO pin pull configuration    */
    gpio_PinSpeed_t      PinSpeed;       /**< GPIO output speed              */
    gpio_PinOutputType_t PinOutType;     /**< GPIO output style              */
    gpio_AltFunction_t   PinAltFunction; /**< Alternate function used by pin */
    gpio_PinLevel_t      PinActiveLevel; /**< Pin level in active state      */
}   gpio_Config_t;
```

**Чому:** знання про плату тоді живе в **таблиці**, а код, що її застосовує, однаковий для кожної плати. Погляньте на приклад, який я скомпілював і запустив: плата — це два записи, а ініціалізація — цикл.

```c title="board.c"
#include <stdbool.h>
#include "Gpio_Port.h"

/* The board is data: which pin is what, and what "active" means for it. */
typedef enum { BOARD_IO_LED, BOARD_IO_BUTTON, BOARD_IO_CNT } boardIo_t;

static gpio_Config_t boardPins[BOARD_IO_CNT] =
{
    [BOARD_IO_LED] =
    {
        .PortId = GPIO_PORT_A, .PinId = GPIO_PIN_ID_5, .PinMode = GPIO_PIN_MODE_OUTPUT,
        .PinPull = GPIO_PIN_PULL_NONE, .PinSpeed = GPIO_PIN_SPEED_LOW,
        .PinOutType = GPIO_PIN_OUTPUT_PUSHPULL, .PinAltFunction = GPIO_ALT_FUNC_CNT,
        .PinActiveLevel = GPIO_PIN_LEVEL_LOW        /* this LED is connected to the supply: low = on */
    },
    [BOARD_IO_BUTTON] =
    {
        .PortId = GPIO_PORT_C, .PinId = GPIO_PIN_ID_13, .PinMode = GPIO_PIN_MODE_INPUT,
        .PinPull = GPIO_PIN_PULL_NONE, .PinSpeed = GPIO_PIN_SPEED_LOW,
        .PinOutType = GPIO_PIN_OUTPUT_PUSHPULL, .PinAltFunction = GPIO_ALT_FUNC_CNT,
        .PinActiveLevel = GPIO_PIN_LEVEL_HIGH
    },
};

bool Board_Init(void)
{
    bool isOk = true;

    for (uint32_t index = 0u; index < (uint32_t)BOARD_IO_CNT; index++)
    {
        if (GPIO_REQUEST_OK != Gpio_Init(&boardPins[index]))
        {
            isOk = false;
        }
    }
    return isOk;
}

bool Board_Set_Led(bool isOn)
{
    const gpio_Config_t *led = &boardPins[BOARD_IO_LED];

    return (GPIO_REQUEST_OK == (isOn
        ? Gpio_Set_PinStateActive  (led->PortId, led->PinId, led->PinActiveLevel)
        : Gpio_Set_PinStateInactive(led->PortId, led->PinId, led->PinActiveLevel)));
}
```

Оскільки таблиця — це дані, нова ревізія друкованої плати змінює рядок у таблиці й нічого в коді. В архітектурі Embedbits це завдання шару HAL: він тримає таблиці й використовує MCAL, щоб їх застосувати.

**Ціна:** структура має вісім полів, і кожен запис має заповнити всі (designated initializers роблять це читабельним, а пропущене поле дорівнює нулю, що не завжди розумне значення). Тому функція `Get_DefaultConfig`, яку мають деякі інші модулі, — корисний супутник.

## 4. Полярність сигналу — властивість піна, а не коду

Структура має поле `PinActiveLevel`, а також функції `Gpio_Set_PinStateActive()` і `Gpio_Set_PinStateInactive()`, які приймають полярність як параметр. Причина — простий факт електроніки: світлодіод можна під'єднати до землі (він світиться при **високому** рівні) або до живлення (він світиться при **низькому** рівні), а сигнал chip-select зазвичай *active low*. Якщо код каже `Gpio_Set_PinLevel(..., HIGH)` для «світлодіод увімкнено», він правильний для однієї плати й хибний для наступної.

З полярністю в таблиці застосунок каже «увімкнено», а таблиця — що це означає. У наведеному вище прикладі світлодіод під'єднано до живлення, тож `PinActiveLevel` — це `GPIO_PIN_LEVEL_LOW`, і тест підтверджує, що робить пін:

```text
after Board_Init():      the pin is high (the LED is off)
after Board_Set_Led(1):  the pin is low  (the LED is on)
```

## 5. Переліки — це константи вендора

Типи не вигадують власних чисел, вони є числами драйвера вендора:

```c
typedef enum
{
    GPIO_PIN_MODE_INPUT     = LL_GPIO_MODE_INPUT,     /**< Select input mode              */
    GPIO_PIN_MODE_OUTPUT    = LL_GPIO_MODE_OUTPUT,    /**< Select output mode             */
    GPIO_PIN_MODE_ALTERNATE = LL_GPIO_MODE_ALTERNATE, /**< Select alternate function mode */
    GPIO_PIN_MODE_ANALOG    = LL_GPIO_MODE_ANALOG     /**< Select analog mode             */
}   gpio_PinMode_t;
```

**Чому:** перетворення з типу MCAL у значення, яке хоче функція LL, **безкоштовне**: немає `switch`, немає таблиці й немає способу зробити друкарську помилку в перекладі. Значення констант різняться від сімейства до сімейства, і це сховано в одному `#include` порту RAL (специфічний для сімейства `Stm32_gpio.h`).

**Ціна:** `Gpio_Types.h`, публічний заголовок, включає заголовок RAL, тож константи вендора просочуються в заголовки, які бачать користувачі модуля. Альтернатива — тип із власними значеннями й таблицею перекладу у файлі `.c`, що коштує коду й місця для помилки, але тримає вендора поза публічними заголовками. Це рішення — компроміс, і добре знати, що воно таке.

## 6. Той самий життєвий цикл, що й у кожного іншого модуля

`Gpio_Get_ModuleVersion()`, `Gpio_Init()`, `Gpio_Deinit()` і `Gpio_Task()` походять із шаблону, з якого починається кожен модуль (див. статтю про [організацію файлів](/blog/file-organization-embedded-c)). Різниця в єдиному місці, де вона має сенс: `Gpio_Init()` не `void`, вона приймає **конфігурацію піна**. Модуль GPIO не знає плати, тож «ініціалізувати модуль» не має сенсу без запитання «який пін?». Єдиний життєвий цикл, який гнеться там, де цього вимагає природа модуля, кращий за життєвий цикл, нав'язаний модулю, якому він не підходить.

## 7. Порядок кроків — частина інтерфейсу

Погляньте на коментар до `Gpio_Init()`:

```c
/**
 * Activates the port clock and configures the pin. Output level (inactive state),
 * output type, speed, pull and alternate function are configured before the pin
 * mode, so an output pin starts directly with its inactive level (no glitch).
 * Configuration stops at the first failed step.
 */
```

Режим піна, тобто крок, який насправді **підключає вихідний драйвер до виводу**, — останній. Якби режим ішов першим, пін на мить видавав би рівень, який вихідний регістр мав після скидання (зазвичай низький), а потім стрибав би на правильний: імпульс на лінії, що може бути chip-select, скиданням іншої мікросхеми або затвором транзистора. Такий glitch невидимий у відлагоднику й видимий на осцилографі. Це хороший приклад правила проєктування API: **коли порядок кроків важливий для апаратури, функція, що їх виконує, має володіти порядком**, щоб користувач не міг його переплутати.

Друге речення коментаря, «stops at the first failed step», — теж проєктне рішення: функція не намагається продовжувати після помилки і повертає стан кроку, що зазнав невдачі.

## 8. Хибний аргумент — це помилка, яку бачить викликач, а не аварія

Функції перевіряють свої аргументи, а відповідь — це стан:

```c
assert(GPIO_REQUEST_ERROR == Gpio_Init(GPIO_NULL_PTR));
assert(GPIO_REQUEST_ERROR == Gpio_Get_PinLevel(GPIO_PORT_CNT, GPIO_PIN_ID_0, &level));
assert(GPIO_REQUEST_ERROR == Gpio_Set_PinLevel(GPIO_PORT_A, GPIO_PIN_ID_CNT, GPIO_PIN_LEVEL_HIGH));
```

(Це тест моєї заглушки, але справжня `Gpio_Init()` робить те саме для `NULL`: усе тіло знаходиться всередині `if( GPIO_NULL_PTR != gpioConfig )`.) Константи `_CNT` тут мають друге завдання: `GPIO_PORT_CNT` — це перше значення, яке **не** є дійсним портом, тож перевірка — це одне порівняння. У firmware немає кому показати повідомлення, а `assert`, що зупиняє програму, зазвичай хибна відповідь для робочої збірки. Помилка, що піднімається до викликача, який знає, що робити (і до модуля над MCAL, який знає, що критично), — краща відповідь.

## До чого б я повернувся

Чесний огляд дизайну завжди має перелік, і цей має два пункти, що походять зі статті про MISRA:

- `Gpio_Init( gpio_Config_t *gpioConfig )` лише **читає** структуру, тож параметр міг би бути `const gpio_Config_t *` (Rule 8.13). Сигнатура говорила б, що функція не змінює конфігурацію, а таблиця плати могла б бути `const` і жити у flash замість RAM.
- Двозначний `gpio_RequestState_t` однаковий у кожному модулі (його генерує шаблон). Це просте й єдине рішення, правильне для GPIO, а модулям із реальними збоями рано чи пізно знадобиться більше.

## Принципи коротко

1. **Ховайте апаратуру, а не намір.** Користувач каже *який пін* і *яка полярність*, а не *який регістр*.
2. **Робіть недійсний стан видимим.** Статус для всього, що може зазнати невдачі, а вихідні дані — лише за успіху.
3. **Кладіть знання в дані.** Плата — це таблиця, яку читає цикл.
4. **Нехай функція володіє порядком,** коли апаратура про нього дбає.
5. **Тримайте інтерфейс єдиним і чесно кажіть, де він гнеться** (`Init` з параметром) та де абстракція протікає (константи вендора в типах).

Інтерфейс має двох читачів: користувача сьогодні й супровідника наступного року. Наведені вище рішення написані для обох, а коментарі в заголовках — доказ того, що хтось подумав про другого.
