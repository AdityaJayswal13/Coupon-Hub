const express = require("express");
const path = require("path");
const session = require("express-session");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { userRegistrationSchema } = require("./schema.js");
const couponListing = require('./models/couponListing.js');
const User = require('./models/user.js');

const wrapAsync = require("./utils/WrapAsync.js");
const MONGOURL = "mongodb://127.0.0.1:27017/CouponHub"

const app = express();
const PORT = process.env.PORT || 8000; // Fallback to env var or 8000

main().then(() => {
  console.log("Database Connected");
}).catch((err) => {
  console.log(err);
  console.log("Error in Database Connection");
})

async function main() {
  await mongoose.connect(MONGOURL);
}

// Middleware for session and flash messages
app.use(session({
  secret: "yourSecretKey", 
  resave: false,
  saveUninitialized: true
}));
const flash = require('connect-flash');
app.use(flash());

// Body parser middleware - must come before routes
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Routes
app.get("/", wrapAsync(async (req, res) => {
  try {
      // Get recommendations
      const recommendedCoupons = await couponListing.aggregate([
          { $match: { /* your filters */ } },
          { $sample: { size: 5 } } // Get 5 random coupons for now
      ]);
      
      res.render("index", { 
          recommendedCoupons,
          messages: req.flash()
      });
  } catch (error) {
      console.error("Error loading home page:", error);
      res.status(500).send("Error loading page");
  }
}));

// Route: Sign In Page
app.get("/signin", (req, res) => {
  res.render("signin", { user: req.session.user });
});

// Route: Sign Up Page
app.get("/signup", (req, res) => {
  res.render("signup", { user: req.session.user });
});

// Route: Logout (Destroy Session)
app.get("/signout", (req, res) => {
  req.session.destroy();
  res.redirect("/");
});

// Route: Validate User (Login Handling)
app.post("/validateUser", wrapAsync(async (req, res) => {
  // Debug request headers and body
  console.log('Headers:', req.headers);
  console.log('Raw body:', req.body);
  
  // Ensure proper content-type
  if (!req.is('application/json') && !req.is('application/x-www-form-urlencoded')) {
    return res.status(400).render("signin", { 
      error: "Invalid content type. Please use JSON or form data" 
    });
  }

  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).render("signin", { 
      error: "Request body is missing or empty" 
    });
  }

  const { error } = userLoginSchema.validate(req.body);
  if (error) {
    console.error('Validation error:', error.details);
    return res.status(400).render("signin", { 
      error: error.details[0].message 
    });
  }


  const { email, password } = req.body;
  
  // Find user by email
  const user = await User.findOne({ email });
  if (!user) {
    return res.status(401).render("signin", { error: "Invalid email or password!" });
  }

  // Compare passwords
  // const isMatch = await bcrypt.compare(password, user.password);
  // if (!isMatch) {
  //   return res.status(401).render("signin", { error: "Invalid email or password!" });
  // }

  // Set session and redirect
  req.session.user = user;
  res.redirect("/");
}));

// Route: Register User (Signup Handling)
app.post("/addUser", wrapAsync(async (req, res) => {
  if (!req.body) {
    return res.status(400).json({ error: "Request body is missing" });
  }
  const { error } = userRegistrationSchema.validate(req.body);
  if (error) {
    return res.status(400).render("signup", { error: error.details[0].message });
  }

  const { name, email, phone, password } = req.body;
  
  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(400).render("signup", { error: "Email already registered" });
  }

  // Hash password
  // const hashedPassword = await bcrypt.hash(password, 10);

  // Create new user
  const newUser = new User({
    name,
    email,
    phone,
    password: hashedPassword
  });

  await newUser.save();
  req.session.user = newUser;
  res.redirect("/");
}));

// Get all coupons
app.get("/allCoupons", async (req, res) => {
  try {
    const coupons = await couponListing.find({});
    res.render("allCoupons", { coupons });
  } catch (error) {
    console.error("Error fetching coupons:", error);
    res.status(500).send("Error loading coupons");
  }
});
app.get("/search", wrapAsync(async (req, res) => {
  const searchQuery = req.query.search;
  try {
      const coupons = await couponListing.find({
          $or: [
              { Title: { $regex: searchQuery, $options: 'i' } },
              { OrganizationName: { $regex: searchQuery, $options: 'i' } }
          ]
      });
      res.render("allCoupons", { coupons });
  } catch (error) {
      console.error("Error fetching coupons:", error);
      res.status(500).send("Error loading coupons");
  }
}));

app.post("/allCoupons", wrapAsync(async (req, res) => {
  console.log('Raw coupon submission:', req.body);
  
  try {
    const { code, OrganizationName, Title,discount, price, date, image, TandC,is_redeemed } = req.body;
    
    if (!code || !code.trim()) {
      req.flash("error", "Coupon code is required");
      return res.redirect("/allCoupons");
    }

    if (code.length < 4) {
      req.flash("error", "Coupon code must be at least 4 characters");
      return res.redirect("/allCoupons");
    }

    if (!OrganizationName) {
      req.flash("error", "Organization name is required");
      return res.redirect("/allCoupons");
    }
    const orgImages = {
      Dominos: '/photos/dominos.png',
      Swiggy: '/photos/swiggy.png',
      Zomato: '/photos/zomato.jpg',
      Dell: '/photos/dell.webp',
      One8: '/photos/one8.jpg',
      Croma: '/photos/croma.jpg'
  };
    const newCoupon = new couponListing({
      code: code,
      OrganizationName,
      Title: Title || 'No title provided',
      discount:discount,
      price: price || 0,
      date: date || new Date().toISOString().split('T')[0],
      image: orgImages[OrganizationName], // Save the corresponding image path
      TandC: TandC || 'No terms specified',
      is_redeemed:is_redeemed || 'off',
    });

    await newCoupon.save();
    console.log('New coupon saved:', newCoupon);
    req.flash("success", "Coupon submitted successfully!");
    return res.redirect("/allCoupons");
  } catch (err) {
    console.error('Coupon submission error:', err);
    req.flash("error", "Failed to save coupon. Please try again.");
    return res.redirect("/allCoupons");
  }
}));

app.get("/recommend", wrapAsync(async (req, res) => {
  try {
      // Get user's browsing history (you'll need to implement this)
      // const userId = req.user?.id; // If you have user authentication
      
      // Advanced recommendations based on multiple factors
      const recommendedCoupons = await couponListing.aggregate([
          {
              $match: {
                  // Add any filters here (e.g., valid dates)
                  // date: { $gte: new Date() }
              }
          },
          {
              $addFields: {
                  popularityScore: {
                      $add: [
                          { $multiply: [{ $toInt: "$is_redeemed" }, 5] }, // Redeemed coupons get higher score
                          { $cond: [{ $eq: ["$OrganizationName", "Dominos"] }, 2, 0] }, // Example: boost Dominos
                          { $cond: [{ $eq: ["$couponType", "Food"] }, 1, 0] } // Example: boost Food category
                      ]
                  }
              }
          },
          { $sort: { popularityScore: -1, date: -1 } },
          { $limit: 5 }
      ]);
      
      res.render("index", { recommendedCoupons });
  } catch (error) {
      console.error("Error fetching recommendations:", error);
      res.status(500).send("Error loading recommendations");
  }
}));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start server with recursive port handling
const startServer = (port) => {
  const server = app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
 });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
};

// Start the server
startServer(PORT);
