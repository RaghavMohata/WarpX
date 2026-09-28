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
   belong on the server, not here. `area: null` shows as "Brahmapuri".

   Best-known first (by Google review count, September 2026): the food page
   shows the first eight and folds the rest behind "Show all". */
const RESTAURANTS = [
  { id: "madhuban", name: "Madhuban Agro Tourism & Family Restaurant", kind: "Family restaurant", icon: "🍛", area: "Gangalwadi, Talodhi–Armori Road" },
  { id: "saoji-sharda", name: "Saoji Sharda Family Restaurant & Dhaba", kind: "Dhaba", icon: "🍛", area: "Armori–Nagpur Highway" },
  { id: "new-saoji", name: "New Saoji Dhaba", kind: "Dhaba", icon: "🍛", area: null },
  { id: "hemant", name: "Hemant Ki Tapri (Hemant Cafe)", kind: "Cafe", icon: "☕", area: "Nagpur Highway" },
  { id: "annapurna", name: "Annapurna Lawn & Family Restaurant", kind: "Family restaurant", icon: "🍛", area: "Near the toll gate" },
  { id: "zayka", name: "Zayka Chinese Centre", kind: "Chinese", icon: "🥡", area: "Nagpur Highway, near Sai Petrol Pump" },
  { id: "lakeside", name: "The Lakeside Cafe & Restaurant", kind: "Cafe & restaurant", icon: "☕", area: "Sheshnagar, near Ganvir Hospital" },
  { id: "blossom", name: "Blossom Cakes & Cafe", kind: "Bakery & cafe", icon: "🍰", area: "Armori Road, beside Alankar Theatre" },
  { id: "anand", name: "Hotel Anand", kind: "Family restaurant", icon: "🍛", area: null },
  { id: "ujwal", name: "Ujwal Bar & Restaurant", kind: "Restaurant & bar", icon: "🍽️", area: null },
  { id: "rishta", name: "Rishta Restaurant", kind: "Family restaurant", icon: "🍛", area: null },
  { id: "chai-sutta-bar", name: "Chai Sutta Bar", kind: "Tea cafe", icon: "☕", area: "Wadsa Road, near State Bank of India" },
  { id: "tealogy", name: "Tealogy Cafe", kind: "Cafe", icon: "☕", area: "Christanand Square, opp. CDCC Bank" },
  { id: "malan", name: "Malan Family Restaurant & Lawn", kind: "Family restaurant", icon: "🍛", area: "Armori–Nagpur Highway" },
  { id: "raju-chinese", name: "Raju Chinese Fast Food", kind: "Chinese fast food", icon: "🥡", area: "Nagpur Highway" },
  { id: "pints-and-plate", name: "Pints and Plate Restro", kind: "Restaurant", icon: "🍽️", area: "Ranmochan" },
  { id: "flavours", name: "Flavour's Restaurant", kind: "Restaurant", icon: "🍽️", area: null },
  { id: "ramkamal", name: "Hotel Ramkamal Bar & Restaurant", kind: "Restaurant & bar", icon: "🍽️", area: "Gogav Road" },
  { id: "abhay", name: "Abhay Bhojnalay Biryani Center", kind: "Biryani", icon: "🍛", area: "Chandgaon Road" },
  { id: "samadhan", name: "Hotel Samadhan", kind: "Family restaurant", icon: "🍛", area: null },
  { id: "foodi", name: "Foodi Snack Zone", kind: "Cakes & fast food", icon: "☕", area: "Near Fawara Chowk" },
  { id: "jalsa", name: "Jalsa Family Restaurant & Bar", kind: "Restaurant & bar", icon: "🍽️", area: "Chimur Road" },
  { id: "kamal-dhaba", name: "Kamal Dhaba", kind: "Dhaba", icon: "🍛", area: "Nagpur Highway" },
  { id: "chill-out", name: "Chill Out Restaurant & Bar", kind: "Restaurant & bar", icon: "🍽️", area: null },
  { id: "shrinath", name: "Shrinath Bhel Paanipuri Center", kind: "Bhel & paani puri", icon: "🥟", area: "Armori–Nagpur Highway" },
  { id: "deveshri", name: "The Deveshri Dine In", kind: "Self-service restaurant", icon: "🍽️", area: "Opposite Barai Lake, Wadsa Road" },
  { id: "amol-chai", name: "Amol Chai", kind: "Tea stall", icon: "☕", area: "Wadsa Road, near Christian School" },
  { id: "shalwan", name: "Shalwan Bar & Restaurant", kind: "Restaurant & bar", icon: "🍽️", area: "Fawara Chowk, above Maharashtra Bank" },
  { id: "high-note", name: "High Note Restaurant", kind: "Restaurant", icon: "🍽️", area: "Wadsa–Brahmapuri Highway" },
  { id: "hindusthan", name: "Hindusthan Hotel", kind: "Restaurant", icon: "🍽️", area: "Kambde Complex, opp. Tahsil Office" },
  { id: "prajwal", name: "Prajwal Bar & Restaurant", kind: "Restaurant & bar", icon: "🍽️", area: null },
  { id: "vada-pav-center", name: "Vada Pav Center", kind: "Fast food", icon: "🍔", area: "Nagbhid Road, near Ladukar Hospital" },
  { id: "kranti-mangalam", name: "Kranti Mangalam Restaurant", kind: "Restaurant", icon: "🍽️", area: null },
  { id: "taj-biryani", name: "Taj Chicken Biryani", kind: "Biryani", icon: "🍛", area: null },
  { id: "bramhapuri-wadapao", name: "Bramhapuri Wadapao", kind: "Vada pav takeaway", icon: "🍔", area: "Hutatma Smarak, Wadsa Road" },
  { id: "milan-chinese", name: "Milan Chinese & Fast Food", kind: "Chinese fast food", icon: "🥡", area: null },
  { id: "gulmohar", name: "Gulmohar Biryani House", kind: "Biryani", icon: "🍛", area: null },
  { id: "gujarati-bhojnalaya", name: "Gujarati Bhojnalaya", kind: "Restaurant", icon: "🍽️", area: "Nagpur Highway" },
  { id: "virai", name: "Virai Restaurant", kind: "Ice cream", icon: "🍨", area: "Main Road, near old Anand Talkies" },
  { id: "jay-jalaram", name: "Jay Jalaram Hotel", kind: "Restaurant", icon: "🍽️", area: null },
  { id: "sakhambhari", name: "Sakhambhari Sweets", kind: "Sweets", icon: "🍬", area: null },
  { id: "shivgad", name: "Shivgad Rasvanti & Restaurant", kind: "Sugarcane juice & restaurant", icon: "🥤", area: "Maldongri Road, near Vidarbha Colony" },
  { id: "reewin", name: "Hotel Reewin", kind: "Restaurant", icon: "🍽️", area: "Nagbhid Road, opp. Rakhde Hospital" },
  { id: "vanktesh", name: "Vanktesh (Anna) South Indian", kind: "South Indian", icon: "🍽️", area: null },
  { id: "punjabi-dhaba", name: "Punjabi Dhaba & Family Restaurant", kind: "Dhaba", icon: "🍛", area: "Nagpur Highway" },
  { id: "athrva", name: "Athrva Manchurian", kind: "Chinese fast food", icon: "🥡", area: "Wadsa Road" },
  { id: "kiran-nasta", name: "Kiran Nasta", kind: "Breakfast & snacks", icon: "🥟", area: "College Road" },
  { id: "shishupal", name: "Shishupal Samosa", kind: "Samosa & snacks", icon: "🥟", area: "Sant Ravidas Chowk" },
  { id: "shrihan", name: "Shrihan Nasta Point", kind: "Breakfast & snacks", icon: "🥟", area: "Renuka Mata Chowk" },
  { id: "sunlight", name: "Sunlight Bar & Restaurant", kind: "Restaurant & bar", icon: "🍽️", area: "Fawara Chowk" },
  { id: "vinod-nasta", name: "Vinod Nasta", kind: "Breakfast & snacks", icon: "🥟", area: null },
  { id: "campus-food-point", name: "Campus Food Point", kind: "Cafe", icon: "☕", area: "Kurja T-Point, Wadsa Road" },
  { id: "new-golden-chinese", name: "New Golden Chinese Centre", kind: "Chinese", icon: "🥡", area: "Wadsa Road" },
  { id: "hotel-royal", name: "Hotel Royal", kind: "Veg & non-veg restaurant", icon: "🍽️", area: null },
  { id: "pride-palace", name: "Pride Palace Family Restaurant", kind: "Family restaurant", icon: "🍛", area: "Wadsa Road" },
];

// Present when required by Node, harmless when this runs as a browser script.
// The server prices every cafe order from this same list, so the menu the
// customer sees and the menu they're charged from cannot drift apart.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { PICASSO_MENU, RESTAURANTS };
}
