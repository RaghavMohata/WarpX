/* Picasso Cafe menu — extracted from the supplied menu PDF. */
const PICASSO_MENU = [
  {
    category: "Cold Brews",
    icon: "🧊",
    items: [
      { name: "Classic Cold Brew", price: 99 },
      { name: "Tangy Brew", price: 119 },
      { name: "Berry Brew", price: 119, tag: "Crowd Favorite" },
      { name: "Cold Brew Tonic", price: 129 },
      { name: "Honey Lemon Brew", price: 129, note: "After 10 successful in-house experiments" },
    ],
  },
  {
    category: "Mocktails",
    icon: "🍹",
    items: [
      { name: "Pina Colada", price: 119, note: "Takes you into the tropical islands" },
      { name: "Virgin Mojito", price: 119, note: "Lemon, mint and fizz in a cup" },
      { name: "Peachy Melon Sunset", price: 129, note: "Sweet peach and melon with a refreshing finish" },
      { name: "Peach Mojito", price: 129, note: "Fruity and minty went for a walk" },
      { name: "Bubble Berrygum", price: 129, note: "Refreshment with a chewing-gum taste" },
      { name: "Chilli Guava Thunder", price: 139, tag: "Hot Pick", note: "Guava with a bold chilli kick" },
      { name: "Spicy Mango Smash", price: 139, note: "Kachha aam, throughout the year" },
    ],
  },
  {
    category: "Munchies",
    icon: "🍟",
    items: [
      { name: "Chana Jor Twist", price: 69, moq: 2, note: "Chana got a little too chatty" },
      { name: "Choco Beast Toast", price: 99, tag: "Dessert" },
      { name: "Cheese Bread Pizza", price: 129 },
      { name: "Cheese Nachos", price: 139, tag: "Picasso's Signature" },
    ],
  },
  {
    category: "Shakes",
    icon: "🥤",
    items: [
      { name: "The Choco Hazelnut", price: 149 },
      { name: "Strawberry Velvet Shake", price: 149, note: "For the rare ones who don't love chocolate" },
      { name: "The Cacao Royale", price: 169, tag: "King of All Drinks" },
    ],
  },
  {
    category: "Speciality Coffees",
    icon: "☕",
    items: [
      { name: "Americano", price: 79 },
      { name: "Iced Americano", price: 89 },
      { name: "Iced Mocha Americano", price: 99 },
      { name: "Iced Latte", price: 99 },
      { name: "Iced Mocha", price: 109 },
      { name: "Hazelnut Latte", price: 129, note: "Coffee got nutty. We didn't stop it." },
      { name: "Vietnamese Iced Latte", price: 129, tag: "Hot Pick", note: "Thick and rich coffee without the bitterness" },
      { name: "Spanish Iced Latte", price: 149 },
    ],
  },
  {
    category: "Others",
    icon: "🍶",
    items: [
      { name: "Bottle 10", price: 10 },
      { name: "Bottle 20", price: 20 },
      { name: "Blue Pea Chill", price: 89 },
    ],
  },
];
