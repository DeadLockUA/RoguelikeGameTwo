// Эксперимент 4 «Секвенсор» — данные.
window.E4 = window.E4 || {};

(function (E4, E99) {
  'use strict';

  // kind: 'note' — инструмент (звук + эффект), 'mod' — модификатор шага.
  E4.NOTES = {
    kick:   { name: 'Бочка',         icon: '◉', color: '#ff6b6b', kind: 'note', desc: 'Ударная волна вокруг корабля: 16 урона и отброс.' },
    snare:  { name: 'Малый барабан', icon: '✕', color: '#ffd43b', kind: 'note', desc: 'Выстрел в ближайшего врага: 22 урона, пробивает одного.' },
    hat:    { name: 'Хай-хэт',       icon: '⋮', color: '#a5d8ff', kind: 'note', desc: 'Три быстрые иглы веером, по 7 урона.' },
    pad:    { name: 'Пэд',           icon: '◇', color: '#63e6be', kind: 'note', desc: 'Заряд щита (до 3), щит поглощает удар. Лечит 2.' },
    bass:   { name: 'Бас',           icon: '▼', color: '#b197fc', kind: 'note', desc: 'Тяжёлая медленная сфера: 45 урона, пробивает троих.' },
    dash:   { name: 'Рывок',         icon: '➤', color: '#ffa94d', kind: 'note', desc: 'Рывок по направлению движения с неуязвимостью, бьёт всех на пути (15).' },
    clap:   { name: 'Хлопок',        icon: '✺', color: '#f783ac', kind: 'note', desc: 'Кольцо из 8 снарядов во все стороны, по 10 урона.' },
    synth:  { name: 'Синт',          icon: '∿', color: '#69db7c', kind: 'note', desc: 'Молния по цепочке: 3 врага, по 14 урона.' },
    accent: { name: 'Акцент',        icon: '!', color: '#ffffff', kind: 'mod',  desc: 'Все ноты на этом шаге звучат громче: эффект ×1.8.' },
    echo:   { name: 'Эхо',           icon: '↺', color: '#adb5bd', kind: 'mod',  desc: 'Ноты этого шага повторяются на следующем шаге с силой 50%.' },
  };

  E4.START_UNLOCKED = ['kick', 'snare', 'hat', 'pad'];
  E4.UNLOCKS = [
    { id: 'bass', cost: 60 },
    { id: 'accent', cost: 80 },
    { id: 'dash', cost: 90 },
    { id: 'clap', cost: 120 },
    { id: 'echo', cost: 150 },
    { id: 'synth', cost: 180 },
  ];

  const geo = E99.geo, list = E99.list;
  E4.UPGRADES = [
    { id: 'steps', name: 'Длина такта', max: 4, cost: list([50, 150, 380, 800]), desc: (l) => `Шагов в цикле: ${8 + 2 * l}` },
    { id: 'tracks', name: 'Дорожки', max: 2, cost: list([120, 480]), desc: (l) => `Дорожек: ${2 + l}` },
    { id: 'bpm', name: 'Темп', max: 5, cost: geo(35, 1.6), desc: (l) => `Темп: ${100 + 8 * l} BPM` },
    { id: 'hp', name: 'Корпус', max: 6, cost: geo(20, 1.55), desc: (l) => `Прочность: ${100 + 25 * l}` },
    { id: 'move', name: 'Двигатели', max: 5, cost: geo(20, 1.5), desc: (l) => `Скорость корабля: +${10 * l}%` },
    { id: 'magnet', name: 'Сборщик', max: 4, cost: geo(15, 1.6), desc: (l) => `Радиус сбора опыта: +${25 * l}%` },
    { id: 'startKit', name: 'Стартовый набор', max: 3, cost: geo(80, 2.2), desc: (l) => `Случайных нот на старте: ${l}` },
    { id: 'records', name: 'Проигрыватель', max: 2, cost: list([150, 550]), desc: (l) => `Пластинок с собой в забег: ${1 + l}` },
    { id: 'recordPower', name: 'Громкость пластинок', max: 5, cost: geo(50, 1.7), desc: (l) => `Сила пластинок: ${50 + 10 * l}%` },
  ];

  E4.MAX_RECORDS = 16;
})(window.E4, window.E99);
