// Эксперимент 1 «Матрёшка» — справочные данные: модули, улучшения лаборатории, враги.
window.E1 = window.E1 || {};

(function (E1) {
  'use strict';

  // kind: 'stat'    — модифицирует снаряды уровня, в который вставлен;
  //       'trigger' — порождает вложенные снаряды и имеет собственную схему (child);
  //       'fossil'  — окаменелость: замороженный билд прошлого забега.
  E1.MODS = {
    dmg:    { name: 'Усилитель',   icon: '✚', kind: 'stat', color: '#ff6b6b', desc: '+40% урона снарядов этого уровня.' },
    speed:  { name: 'Ускоритель',  icon: '»', kind: 'stat', color: '#4dabf7', desc: '+25% скорости полёта снарядов этого уровня.' },
    pierce: { name: 'Бронебой',    icon: '⇥', kind: 'stat', color: '#e599f7', desc: '+1 пробитие: снаряд проходит сквозь ещё одного врага.' },
    rate:   { name: 'Метроном',    icon: '♪', kind: 'stat', color: '#ffd43b', desc: '+25% частоты: турели, минёры и окаменелости этого уровня срабатывают чаще. На корабле — ускоряет основной огонь.' },
    size:   { name: 'Расширитель', icon: '◯', kind: 'stat', color: '#69db7c', desc: '+35% размера снарядов этого уровня.' },
    homing: { name: 'Искатель',    icon: '➶', kind: 'stat', color: '#38d9a9', desc: 'Снаряды этого уровня наводятся на ближайших врагов (стакается).' },
    life:   { name: 'Стабилизатор',icon: '∞', kind: 'stat', color: '#a5d8ff', desc: '+40% времени жизни (дальности) снарядов этого уровня.' },
    multi:  { name: 'Дубликатор',  icon: '⧉', kind: 'stat', color: '#ffa94d', desc: 'Каждый выпуск снаряда этого уровня даёт +1 копию веером.' },

    turret: { name: 'Турель',   icon: '◎', kind: 'trigger', color: '#7df9ff', interval: 0.35, count: 1,
              desc: 'Снаряд сам становится турелью: каждые 0.35 с стреляет вложенным снарядом в ближайшего врага.' },
    shards: { name: 'Осколки',  icon: '✸', kind: 'trigger', color: '#ff8787', event: 'death', count: 5,
              desc: 'Когда снаряд исчезает, он разлетается на 5 вложенных снарядов по кругу.' },
    spark:  { name: 'Искра',    icon: 'ϟ', kind: 'trigger', color: '#fff3bf', event: 'hit', count: 2,
              desc: 'При попадании выпускает 2 вложенных снаряда в соседних врагов.' },
    orbit:  { name: 'Спутники', icon: '☉', kind: 'trigger', color: '#d0bfff', event: 'spawn', count: 2,
              desc: '2 вложенных снаряда кружат вокруг снаряда-носителя, пока он жив.' },
    mine:   { name: 'Минёр',    icon: '⊕', kind: 'trigger', color: '#ffc078', interval: 0.25, count: 1,
              desc: 'Каждые 0.25 с оставляет на пути неподвижный вложенный снаряд-мину.' },

    fossil: { name: 'Окаменелость', icon: '◈', kind: 'fossil', color: '#f08c00', interval: 1.4,
              desc: 'Целиком выпускает билд прошлого забега (ослабленный) каждые 1.4 с.' },
  };

  E1.START_UNLOCKED = ['dmg', 'speed', 'pierce', 'rate', 'turret', 'shards'];

  // Разблокировки новых модулей в лаборатории (одноразовые покупки).
  E1.UNLOCKS = [
    { id: 'spark',  cost: 60 },
    { id: 'size',   cost: 40 },
    { id: 'life',   cost: 50 },
    { id: 'orbit',  cost: 140 },
    { id: 'homing', cost: 120 },
    { id: 'mine',   cost: 180 },
    { id: 'multi',  cost: 260 },
  ];

  const geo = (base, k) => (lvl) => Math.round(base * Math.pow(k, lvl));
  const list = (arr) => (lvl) => arr[lvl];

  // Постоянные улучшения (инкрементальная часть).
  E1.UPGRADES = [
    { id: 'depth', name: 'Глубина вложенности', max: 3, cost: list([60, 240, 800]),
      desc: (l) => `Максимальная глубина матрёшки: ${1 + l}` },
    { id: 'rootSlots', name: 'Слоты корабля', max: 4, cost: geo(30, 2.0),
      desc: (l) => `Слотов в схеме корабля: ${2 + l}` },
    { id: 'childSlots', name: 'Слоты снарядов', max: 2, cost: list([120, 480]),
      desc: (l) => `Слотов во вложенных снарядах: ${1 + l}` },
    { id: 'hp', name: 'Корпус', max: 6, cost: geo(20, 1.55),
      desc: (l) => `Прочность: ${100 + 25 * l}` },
    { id: 'move', name: 'Двигатели', max: 5, cost: geo(20, 1.5),
      desc: (l) => `Скорость корабля: +${10 * l}%` },
    { id: 'magnet', name: 'Сборщик', max: 4, cost: geo(15, 1.6),
      desc: (l) => `Радиус сбора опыта: +${25 * l}%` },
    { id: 'xp', name: 'Анализатор', max: 5, cost: geo(30, 1.6),
      desc: (l) => `Получаемый опыт: +${10 * l}%` },
    { id: 'startKit', name: 'Стартовый набор', max: 3, cost: geo(80, 2.2),
      desc: (l) => `Случайных модулей на старте: ${l}` },
    { id: 'fossilSlots', name: 'Хранилище окаменелостей', max: 2, cost: list([150, 550]),
      desc: (l) => `Окаменелостей с собой в забег: ${1 + l}` },
    { id: 'fossilPower', name: 'Резонанс окаменелостей', max: 5, cost: geo(50, 1.7),
      desc: (l) => `Сила окаменелостей: ${50 + 10 * l}%` },
  ];

  E1.ENEMIES = {
    grunt:    { name: 'Слизень',    hp: 22,   speed: 75,  r: 12, dmg: 10, color: '#ff5c5c', xp: 1 },
    runner:   { name: 'Бегун',      hp: 11,   speed: 150, r: 8,  dmg: 7,  color: '#ff9f43', xp: 1 },
    splitter: { name: 'Делитель',   hp: 45,   speed: 65,  r: 15, dmg: 12, color: '#1dd1a1', xp: 2, split: true },
    brute:    { name: 'Громила',    hp: 140,  speed: 48,  r: 22, dmg: 20, color: '#c56cf0', xp: 4 },
    spitter:  { name: 'Плевун',     hp: 32,   speed: 70,  r: 12, dmg: 8,  color: '#54a0ff', xp: 2, ranged: true },
    boss:     { name: 'Матка',      hp: 1800, speed: 40,  r: 42, dmg: 30, color: '#ff3f34', xp: 40, boss: true },
  };

  E1.DEPTH_COLORS = ['#7df9ff', '#ffe66d', '#ff6bd6', '#7dff8a', '#ffa94d', '#b197fc', '#ff6b6b', '#ffffff'];
  E1.WAVE_DURATION = 30;
})(window.E1);
