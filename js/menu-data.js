/* Picasso Cafe menu — extracted from the supplied menu PDF.

   To put a photo on an item, drop the file in img/menu/ and add an `img`
   field: { name: "Berry Brew", price: 134, img: "img/menu/berry-brew.jpg" }.
   Items without one show a tinted tile carrying the category mark, so the
   menu stays presentable while the photographs are being taken.
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
      { name: "Pina Colada", price: 134, note: "Takes you into the tropical islands", img: "img/menu/pina-colada.jpg", full: "img/menu/full/pina-colada.jpg" },
      { name: "Virgin Mojito", price: 134, note: "Lemon, mint and fizz in a cup", img: "img/menu/virgin-mojito.jpg", full: "img/menu/full/virgin-mojito.jpg" },
      { name: "Peachy Melon Sunset", price: 144, note: "Sweet peach and melon with a refreshing finish", img: "img/menu/peachy-melon-sunset.jpg", full: "img/menu/full/peachy-melon-sunset.jpg" },
      { name: "Peach Mojito", price: 144, note: "Fruity and minty went for a walk" },
      { name: "Bubble Berrygum", price: 144, note: "Refreshment with a chewing-gum taste", img: "img/menu/bubble-berrygum.jpg", full: "img/menu/full/bubble-berrygum.jpg" },
      { name: "Chilli Guava Thunder", price: 154, tag: "Hot Pick", note: "Guava with a bold chilli kick", img: "img/menu/chilli-guava-thunder.jpg", full: "img/menu/full/chilli-guava-thunder.jpg" },
      { name: "Spicy Mango Smash", price: 154, note: "Kachha aam, throughout the year", img: "img/menu/spicy-mango-smash.jpg", full: "img/menu/full/spicy-mango-smash.jpg" },
    ],
  },
  {
    category: "Munchies",
    icon: "🍟",
    items: [
      { name: "Chana Jor Twist", price: 84, moq: 2, note: "Chana got a little too chatty" },
      { name: "Choco Beast Toast", price: 114, note: "Thick toast buried under dark chocolate sauce and chunks", tag: "Dessert", img: "img/menu/choco-beast-toast.jpg", full: "img/menu/full/choco-beast-toast.jpg" },
      { name: "Cheese Bread Pizza", price: 144, note: "Bread-base slices loaded with cheese, corn and olives", img: "img/menu/cheese-bread-pizza.jpg", full: "img/menu/full/cheese-bread-pizza.jpg" },
      { name: "Cheese Nachos", price: 154, note: "Crisp nachos under melted cheese, salsa and olives", tag: "Picasso's Signature", img: "img/menu/cheese-nachos.jpg", full: "img/menu/full/cheese-nachos.jpg" },
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

/* Restaurants shown on the food page with their menus still to come. Names
   and areas only: none of these takes orders yet.

   Before one of them gets a menu, orders need routing to the right kitchen.
   Today every food order is priced from PICASSO_MENU, emailed to Picasso,
   and collected from Picasso's address ("One cafe" under Known limitations
   in the README), so another restaurant's items would go to Picasso.

   This file is public. A restaurant's email, phone and exact pickup address
   belong on the server, not here. `area: null` shows as "Brahmapuri". */
const RESTAURANTS = [
  { id: "annapurna", name: "Annapurna Lawn & Family Restaurant", kind: "Family restaurant", icon: "🍛", area: "Near the toll gate" },
  { id: "blossom", name: "Blossom Cakes & Cafe", kind: "Bakery & cafe", icon: "🍰", area: "Armori Road, beside Alankar Theatre" },
  { id: "bramhapuri-wadapao", name: "Bramhapuri Wadapao", kind: "Vada pav takeaway", icon: "🍔", area: "Hutatma Smarak, Wadsa Road" },
  { id: "chill-out", name: "Chill Out Restaurant & Bar", kind: "Restaurant & bar", icon: "🍽️", area: null },
  { id: "flavours", name: "Flavour's Restaurant", kind: "Restaurant", icon: "🍽️", area: null },
  { id: "foodi", name: "Foodi Snack Zone", kind: "Cakes & fast food", icon: "☕", area: "Near Fawara Chowk" },
  { id: "anand", name: "Hotel Anand", kind: "Family restaurant", icon: "🍛", area: null },
  { id: "reewin", name: "Hotel Reewin", kind: "Restaurant", icon: "🍽️", area: "Nagbhid Road, opp. Rakhde Hospital" },
  { id: "samadhan", name: "Hotel Samadhan", kind: "Family restaurant", icon: "🍛", area: null },
  { id: "kranti-mangalam", name: "Kranti Mangalam Restaurant", kind: "Restaurant", icon: "🍽️", area: null },
  { id: "new-saoji", name: "New Saoji Dhaba", kind: "Dhaba", icon: "🍛", area: null },
  { id: "pints-and-plate", name: "Pints and Plate Restro", kind: "Restaurant", icon: "🍽️", area: "Ranmochan" },
  { id: "rishta", name: "Rishta Restaurant", kind: "Family restaurant", icon: "🍛", area: null },
  { id: "saoji-sharda", name: "Saoji Sharda Family Restaurant & Dhaba", kind: "Dhaba", icon: "🍛", area: "Armori–Nagpur Highway" },
  { id: "tealogy", name: "Tealogy Cafe", kind: "Cafe", icon: "☕", area: "Christanand Square, opp. CDCC Bank" },
  { id: "deveshri", name: "The Deveshri Dine In", kind: "Self-service restaurant", icon: "🍽️", area: "Opposite Barai Lake, Wadsa Road" },
  { id: "lakeside", name: "The Lakeside Cafe & Restaurant", kind: "Cafe & restaurant", icon: "☕", area: "Sheshnagar, near Ganvir Hospital" },
  { id: "ujwal", name: "Ujwal Bar & Restaurant", kind: "Restaurant & bar", icon: "🍽️", area: null },
  { id: "vada-pav-center", name: "Vada Pav Center", kind: "Fast food", icon: "🍔", area: "Nagbhid Road, near Ladukar Hospital" },
  { id: "zayka", name: "Zayka Chinese Centre", kind: "Chinese", icon: "🥡", area: "Nagpur Highway, near Sai Petrol Pump" },
];

// Present when required by Node, harmless when this runs as a browser script.
// The server prices every cafe order from this same list, so the menu the
// customer sees and the menu they're charged from cannot drift apart.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { PICASSO_MENU, RESTAURANTS };
}
