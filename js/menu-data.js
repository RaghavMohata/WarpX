/* Picasso Cafe menu — extracted from the supplied menu PDF.
   Listed prices include WarpX's ₹15 per-item margin on top of the cafe's
   own menu price. Raising or lowering that margin means editing these
   numbers; the admin earnings panel reports it as "food margin". */
const PICASSO_MENU = [
  {
    category: "Cold Brews",
    icon: "🧊",
    items: [
      { name: "Classic Cold Brew", price: 114 },
      { name: "Tangy Brew", price: 134 },
      { name: "Berry Brew", price: 134, tag: "Crowd Favorite" },
      { name: "Cold Brew Tonic", price: 144 },
      { name: "Honey Lemon Brew", price: 144, note: "After 10 successful in-house experiments" },
    ],
  },
  {
    category: "Mocktails",
    icon: "🍹",
    items: [
      { name: "Pina Colada", price: 134, note: "Takes you into the tropical islands" },
      { name: "Virgin Mojito", price: 134, note: "Lemon, mint and fizz in a cup" },
      { name: "Peachy Melon Sunset", price: 144, note: "Sweet peach and melon with a refreshing finish" },
      { name: "Peach Mojito", price: 144, note: "Fruity and minty went for a walk" },
      { name: "Bubble Berrygum", price: 144, note: "Refreshment with a chewing-gum taste" },
      { name: "Chilli Guava Thunder", price: 154, tag: "Hot Pick", note: "Guava with a bold chilli kick" },
      { name: "Spicy Mango Smash", price: 154, note: "Kachha aam, throughout the year" },
    ],
  },
  {
    category: "Munchies",
    icon: "🍟",
    items: [
      { name: "Chana Jor Twist", price: 84, moq: 2, note: "Chana got a little too chatty" },
      { name: "Choco Beast Toast", price: 114, tag: "Dessert" },
      { name: "Cheese Bread Pizza", price: 144 },
      { name: "Cheese Nachos", price: 154, tag: "Picasso's Signature" },
    ],
  },
  {
    category: "Shakes",
    icon: "🥤",
    items: [
      { name: "The Choco Hazelnut", price: 164 },
      { name: "Strawberry Velvet Shake", price: 164, note: "For the rare ones who don't love chocolate" },
      { name: "The Cacao Royale", price: 184, tag: "King of All Drinks" },
    ],
  },
  {
    category: "Speciality Coffees",
    icon: "☕",
    items: [
      { name: "Americano", price: 94 },
      { name: "Iced Americano", price: 104 },
      { name: "Iced Mocha Americano", price: 114 },
      { name: "Iced Latte", price: 114 },
      { name: "Iced Mocha", price: 124 },
      { name: "Hazelnut Latte", price: 144, note: "Coffee got nutty. We didn't stop it." },
      { name: "Vietnamese Iced Latte", price: 144, tag: "Hot Pick", note: "Thick and rich coffee without the bitterness" },
      { name: "Spanish Iced Latte", price: 164 },
    ],
  },
  {
    category: "Others",
    icon: "🍶",
    items: [
      { name: "Bottle 10", price: 25 },
      { name: "Bottle 20", price: 35 },
      { name: "Blue Pea Chill", price: 104 },
    ],
  },
];
