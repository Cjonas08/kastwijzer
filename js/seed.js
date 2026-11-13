// Testartikels met foto's van Unsplash (vrij te gebruiken, unsplash.com/license).
const u = (id) => `https://images.unsplash.com/photo-${id}?w=700&q=75&auto=format&fit=crop`;

const LOOK_CODES = { s: 'sportief', c: 'casual', cc: 'casualchique', b: 'business', ch: 'chique', g: 'gekleed' };

const RAW = [
  ['Witte T-shirt',               'tshirt', '1581655353564-df123a1eb820', '#efefed', 'effen',  'c cc', 'zomer'],
  ['Zwarte T-shirt met opdruk',   'tshirt', '1583743814966-8936f5b7be1a', '#1b1b1c', 'print',  'c', 'zomer'],
  ['Witte polo',                  'polo',   '1671438118097-479e63198629', '#f3f3f1', 'effen',  'c cc', 'zomer'],
  ['Zwarte polo',                 'polo',   '1625910513413-c23b8bb81cba', '#19191c', 'effen',  'c cc', 'zomer'],
  ['Blauwe polo met boordje',     'polo',   '1720514496161-914011a9ee02', '#4c8299', 'effen',  'c cc', 'zomer'],
  ['Lichtblauw hemd',             'hemd',   '1623658580851-3b25bf83b4ea', '#aec7e6', 'effen',  'cc b ch', 'altijd'],
  ['Beige hemd',                  'hemd',   '1776838103951-993ff1ffc916', '#c9b590', 'effen',  'cc b', 'altijd'],
  ['Geruit flanellen hemd',       'hemd',   '1611312449412-6cefac5dc3e4', '#3a3a3a', 'ruit',   'c', 'winter'],
  ['Crème kabeltrui',             'pull',   '1574201635302-388dd92a4c3f', '#e4ded2', 'effen',  'c cc b', 'winter'],
  ['Bruine pull',                 'pull',   '1773747310662-e7cc9e681226', '#6a3a25', 'effen',  'c cc', 'winter'],
  ['Marineblauwe pull',           'pull',   '1611312449297-a69dc9c3987b', '#1e2a45', 'effen',  'cc b ch', 'winter'],
  ['Lichte jeans',                'broek',  '1602293589930-45aad59ba3ab', '#93adc6', 'effen',  'c', 'altijd'],
  ['Donkerblauwe jeans',          'broek',  '1714143136372-ddaf8b606da7', '#33557b', 'effen',  'c cc b', 'altijd'],
  ['Beige chino',                 'broek',  '1473966968600-fa801b869a1a', '#b3a073', 'effen',  'c cc b', 'altijd'],
  ['Zwarte jeans',                'broek',  '1718252540511-e958742e4165', '#1d1d20', 'effen',  'c cc', 'altijd'],
  ['Jeansshort',                  'short',  '1591195853828-11db59a44f6b', '#7f9dc0', 'effen',  'c', 'zomer'],
  ['Lila nethemd',                'hemd',   '1598032895455-526c9e347a87', '#d6cbe4', 'effen',  'b ch g', 'altijd'],
  ['Zwarte pantalon',             'broek',  '1780291366347-f0191b9405f2', '#1c1c1e', 'effen',  'b ch g', 'altijd'],
  ['Saliegroene short',           'short',  '1621496503717-095a410e1566', '#9aa685', 'effen',  'c', 'zomer'],
];

export const SEED_ITEMS = RAW.map(([name, category, photo, hex, pattern, looks, season], i) => ({
  id: 'test-' + String(i + 1).padStart(2, '0'),
  name, category, hex, hex2: pattern === 'ruit' ? '#9a9a9a' : null, pattern, season,
  looks: looks.split(' ').map((k) => LOOK_CODES[k]),
  image: u(photo),
  sourceUrl: '',
  credit: 'Foto: Unsplash',
  test: true,
  createdAt: 1767225600000 + i * 1000, // vaste datum: zelfde testdata op elk toestel
  updatedAt: 0, // zodat echte wijzigingen bij synchronisatie altijd winnen
}));

// Een paar aanpassingen om te tonen dat jij het laatste woord hebt.
export const SEED_OVERRIDES = [
  { key: ['test-08', 'test-13'].sort().join('|'), value: 'yes' }, // flanel + donkere jeans: toch top
  { key: ['test-02', 'test-14'].sort().join('|'), value: 'no' },  // zwarte print-tee + beige chino: liever niet
];
