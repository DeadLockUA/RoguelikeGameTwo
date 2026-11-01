// Эксперимент 2 «Живой корабль» — справочные данные.
window.E2 = window.E2 || {};

(function (E2) {
  'use strict';

  E2.TYPES = ['core', 'armor', 'gun', 'reactor', 'spore', 'spike', 'nerve', 'mutagen'];

  E2.CELLS = {
    core:    { name: 'Ядро',    icon: '●', color: '#ffd43b', hp: 120,
               desc: 'Сердце корабля. Питает клетки вокруг себя. Ядро разрушено — забег окончен.' },
    armor:   { name: 'Броня',   icon: '■', color: '#74c0fc', hp: 40,
               desc: 'Прочная клетка-щит. Быстро разрастается по запитанной области.' },
    gun:     { name: 'Пушка',   icon: '▲', color: '#ff8787', hp: 20,
               desc: 'Стреляет в ближайшего врага. Размножается как «Жизнь» Конвея и гибнет от тесноты.' },
    reactor: { name: 'Реактор', icon: '◆', color: '#69db7c', hp: 25,
               desc: 'Запитанный реактор сам питает клетки вокруг и медленно превращает соседнюю броню в реакторы — так сеть питания ползёт.' },
    spore:   { name: 'Спора',   icon: '✦', color: '#da77f2', hp: 8,
               desc: 'Агрессивный рост даже без питания, но быстро голодает и гибнет от тесноты. Жжёт врагов при контакте.' },
    spike:   { name: 'Шип',     icon: '✚', color: '#ffa94d', hp: 25,
               desc: 'Контактный урон. Ползёт по краю корабля вдоль брони.' },
    nerve:   { name: 'Нерв',    icon: '∿', color: '#63e6be', hp: 15,
               desc: 'Растёт тонкими линиями. Пушки рядом с нервной сетью стреляют быстрее; чем больше сеть, тем сильнее.' },
    mutagen: { name: 'Мутаген', icon: '☣', color: '#c0eb75', hp: 20,
               desc: 'Время от времени превращает соседнюю клетку в случайный тип. Хаос, но сидированный: семя всегда растёт одинаково.' },
  };

  E2.START_UNLOCKED = ['armor', 'gun', 'reactor'];
  E2.UNLOCKS = [
    { id: 'spore', cost: 60 },
    { id: 'spike', cost: 90 },
    { id: 'nerve', cost: 150 },
    { id: 'mutagen', cost: 220 },
  ];

  // Мутации правил — главная награда внутри забега. cell: к какой клетке относится (null — общая).
  E2.MUTATIONS = [
    { id: 'armorB1',     cell: 'armor',   name: 'Рыхлая броня',         desc: 'Броня рождается уже при 1 соседе-броне (вместо 2).' },
    { id: 'thorns',      cell: 'armor',   name: 'Колючая броня',        desc: 'Броня ранит врагов, которые её грызут.' },
    { id: 'gunB2',       cell: 'gun',     name: 'Пушечный выводок',     desc: 'Пушки рождаются при 2 или 3 соседях-пушках (вместо ровно 3).' },
    { id: 'heavyGun',    cell: 'gun',     name: 'Тяжёлый калибр',       desc: 'Пушка, окружённая 4+ бронями, бьёт в 2.5 раза сильнее.' },
    { id: 'gunRange',    cell: 'gun',     name: 'Длинные стволы',       desc: '+35% дальности пушек.', stack: 3 },
    { id: 'coreR',       cell: 'core',    name: 'Мощное ядро',          desc: 'Радиус питания ядра +1.', stack: 2 },
    { id: 'reactorFast', cell: 'reactor', name: 'Цепная реакция',       desc: 'Реактор превращает броню каждые 4 такта (вместо 8).' },
    { id: 'regen',       cell: 'reactor', name: 'Регенерация',          desc: 'Клетки рядом с реактором лечатся на 15% за такт.' },
    { id: 'pulse',       cell: 'reactor', name: 'Пульсар',              desc: 'Каждый 8-й такт все пушки дают тройной залп.' },
    { id: 'sporeMine',   cell: 'spore',   name: 'Споровые мины',        desc: 'Погибшая спора взрывается и ранит врагов рядом.' },
    { id: 'sporeFeed',   cell: 'spore',   name: 'Симбиоз',              desc: 'Споры не голодают, если рядом есть броня.' },
    { id: 'spikeDmg',    cell: 'spike',   name: 'Зазубрины',            desc: 'Шипы наносят в 2 раза больше урона.', stack: 2 },
    { id: 'nerveGun',    cell: 'nerve',   name: 'Рефлекс',              desc: 'Пустая клетка рядом с нервом и 2+ пушками рождает пушку.' },
    { id: 'mutagenTame', cell: 'mutagen', name: 'Направленная мутация', desc: 'Мутаген создаёт только броню, пушки и реакторы.' },
    { id: 'hardShell',   cell: null,      name: 'Хитин',                desc: '+30% прочности всех клеток.', stack: 3 },
    { id: 'fastTick',    cell: null,      name: 'Ускоренный метаболизм', desc: 'Такт автомата на 20% быстрее.', stack: 2 },
  ];

  const geo = (base, k) => (lvl) => Math.round(base * Math.pow(k, lvl));
  const list = (arr) => (lvl) => arr[lvl];

  E2.UPGRADES = [
    { id: 'gridSize', name: 'Размер сетки', max: 4, cost: list([60, 180, 450, 1000]),
      desc: (l) => `Сетка корабля: ${7 + 2 * l}×${7 + 2 * l}` },
    { id: 'seedSlots', name: 'Слоты семени', max: 6, cost: geo(25, 1.7),
      desc: (l) => `Клеток в семени вручную: ${6 + 4 * l}` },
    { id: 'coreHp', name: 'Панцирь ядра', max: 5, cost: geo(20, 1.5),
      desc: (l) => `Прочность ядра: ${120 + 40 * l}` },
    { id: 'engine', name: 'Жгутики', max: 5, cost: geo(20, 1.5),
      desc: (l) => `Скорость корабля: +${10 * l}%` },
    { id: 'tick', name: 'Метаболизм', max: 3, cost: geo(70, 2),
      desc: (l) => `Такт автомата: ${(0.5 - 0.05 * l).toFixed(2)} с` },
    { id: 'heritage', name: 'Наследственность', max: 3, cost: geo(90, 2),
      desc: (l) => `Случайных мутаций на старте: ${l}` },
    { id: 'harvest', name: 'Сбор биомассы', max: 4, cost: geo(40, 1.7),
      desc: (l) => `Биомасса за забег: +${15 * l}%` },
  ];

  E2.ENEMIES = {
    grunt:   { name: 'Слизень',   hp: 22,   speed: 70,  r: 11, dmg: 8,  color: '#ff5c5c' },
    runner:  { name: 'Бегун',     hp: 11,   speed: 140, r: 8,  dmg: 5,  color: '#ff9f43' },
    brute:   { name: 'Громила',   hp: 140,  speed: 45,  r: 20, dmg: 18, color: '#c56cf0' },
    spitter: { name: 'Плевун',    hp: 30,   speed: 65,  r: 11, dmg: 7,  color: '#54a0ff', ranged: true },
    acid:    { name: 'Кислотник', hp: 35,   speed: 80,  r: 11, dmg: 6,  color: '#a9e34b', acid: true },
    boss:    { name: 'Матка',     hp: 1600, speed: 38,  r: 40, dmg: 30, color: '#ff3f34', boss: true },
  };

  E2.CELL = 18;          // размер клетки в мире
  E2.WAVE_DURATION = 30;
  E2.PREVIEW_TICKS = 40;
  E2.MAX_STRAINS = 12;
})(window.E2);
