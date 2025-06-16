// ----- UTILITY FUNCTIONS -----

function showMessage(text, color = "green") {
  const msgDiv = document.getElementById("message");
  msgDiv.textContent = text;
  msgDiv.style.color = color;
}

function stopScanner() {
  if (Quagga && Quagga.running) {
    Quagga.stop();
  }
}

function startScanner(onDetected) {
  stopScanner();

  Quagga.init({
    inputStream: {
      type: "LiveStream",
      constraints: {
        facingMode: "environment" // Rear camera
      },
      target: document.querySelector("#scanner"),
      area: { // This ensures proper sizing within container
        top: "0%",
        right: "0%",
        left: "0%",
        bottom: "0%"
      }
    },
    decoder: {
      readers: ["ean_reader", "code_128_reader", "upc_reader"]
    },
    locate: true
  }, (err) => {
    if (err) {
      console.error("QuaggaJS init error:", err);
      showMessage("❌ Failed to initialize scanner", "red");
      return;
    }
    Quagga.start();
  });

  Quagga.offDetected(); // Clear old listeners
  Quagga.onDetected((data) => {
    const code = data.codeResult.code;
    onDetected(code);
  });
}

const appContent = document.getElementById("appContent");
const modeSelector = document.getElementById("modeSelector");

modeSelector.addEventListener("change", () => {
  const mode = modeSelector.value;
  stopScanner();
  appContent.innerHTML = "";
  showMessage("");

  switch (mode) {
    case "scan":
      loadScanMode();
      break;
    case "add":
      loadAddMode();
      break;
    case "billing":
      loadBillingMode();
      break;
    case "modify":
      loadModifyMode();
      break;
    default:
      break;
  }
});

function loadScanMode() {
  appContent.innerHTML = `
    <h2>Scan Product</h2>
    <div id="scanner"></div>
    <div id="productInfo" style="margin-top: 20px; font-size: 1.2rem; font-weight: 600;">
      Scan a product barcode to see details.
    </div>
  `;

  // Ensure scanner container styles apply before starting scanner
  setTimeout(() => {
    startScanner((barcode) => {
      const product = getProduct(barcode);

      if (product) {
        const price = getEffectivePrice(product);
        document.getElementById("productInfo").innerHTML = `
          <p><strong>Name:</strong> ${product.name}</p>
          <p><strong>Price:</strong> ${price.toFixed(2)} DT</p>
        `;
        showMessage("✅ Product found");
      } else {
        document.getElementById("productInfo").textContent = "❌ Product not found";
        showMessage("❌ Product not found", "red");
      }
    });
  }, 100); // slight delay to ensure DOM is updated
}

// Get product from localStorage (or null)
function getProduct(barcode) {
  const raw = localStorage.getItem(barcode);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Check temporary price validity
function getEffectivePrice(product) {
  if (product.tempPrice && product.tempPriceExpiry) {
    const expiry = new Date(product.tempPriceExpiry);
    if (expiry > new Date()) {
      return product.tempPrice;
    }
  }
  return product.price;
}
function loadAddMode() {
  appContent.innerHTML = `
    <h2>Add Product</h2>
    <div id="scanner"></div>
    <div id="addProductForm" style="margin-top: 20px;">
      <p>Scan a product barcode to begin.</p>
      <div id="barcodeStatus" style="margin-bottom: 1rem;"></div>
      <form id="productForm" style="display: none;">
        <label for="productName">Product Name</label>
        <input type="text" id="productName" required />

        <label for="productPrice">Price (DT)</label>
        <input type="number" id="productPrice" step="0.01" required />

        <button type="submit">Save Product</button>
      </form>
    </div>
  `;

  let currentBarcode = null;

  startScanner((barcode) => {
    if (barcode === currentBarcode) return;
    currentBarcode = barcode;

    const existing = getProduct(barcode);
    const form = document.getElementById("productForm");
    const statusDiv = document.getElementById("barcodeStatus");

    if (existing) {
      form.style.display = "none";
      statusDiv.innerHTML = `
        <p><strong>Barcode:</strong> ${barcode}</p>
        <p><strong>Product:</strong> ${existing.name}</p>
        <p><strong>Price:</strong> ${existing.price.toFixed(2)} DT</p>
      `;
      showMessage("⚠️ Product already exists", "red");
    } else {
      form.style.display = "block";
      document.getElementById("productName").value = "";
      document.getElementById("productPrice").value = "";
      statusDiv.innerHTML = `<p><strong>New barcode:</strong> ${barcode}</p>`;
      showMessage("✅ New product detected. Enter details.");
    }
  });

  document.getElementById("productForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!currentBarcode) return;

    const name = document.getElementById("productName").value.trim();
    const price = parseFloat(document.getElementById("productPrice").value);

    if (!name || isNaN(price)) {
      showMessage("❌ Invalid input", "red");
      return;
    }

    const product = {
      name,
      price
    };

    localStorage.setItem(currentBarcode, JSON.stringify(product));
    showMessage(`✅ Product "${name}" saved`);
    currentBarcode = null;
    e.target.reset();
    document.getElementById("productForm").style.display = "none";
    document.getElementById("barcodeStatus").innerHTML = "";
  });
}
function loadBillingMode() {
  appContent.innerHTML = `
    <h2>Billing Mode</h2>
    <div id="scanner"></div>
    <table id="billingTable" style="width: 100%; margin-top: 1rem; border-collapse: collapse;">
      <thead>
        <tr>
          <th>Barcode</th>
          <th>Name</th>
          <th>Unit Price</th>
          <th>Qty</th>
          <th>Subtotal</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
    <div style="margin-top: 1rem;">
      <p><strong>Total:</strong> <span id="totalAmount">0.00</span> DT</p>
      <label>Payment Amount (DT):</label>
      <input type="number" id="paymentInput" step="0.01" />
      <p><strong>Change:</strong> <span id="changeAmount">0.00</span> DT</p>
    </div>
  `;

  const tableBody = document.querySelector("#billingTable tbody");
  const totalAmountSpan = document.getElementById("totalAmount");
  const changeSpan = document.getElementById("changeAmount");
  const paymentInput = document.getElementById("paymentInput");

  const bill = {}; // barcode => { name, unitPrice, quantity }

  function updateBillingTable() {
    tableBody.innerHTML = "";
    let total = 0;

    Object.entries(bill).forEach(([barcode, item]) => {
      const subtotal = item.unitPrice * item.quantity;
      total += subtotal;

      tableBody.innerHTML += `
        <tr>
          <td>${barcode}</td>
          <td>${item.name}</td>
          <td>${item.unitPrice.toFixed(2)}</td>
          <td>${item.quantity}</td>
          <td>${subtotal.toFixed(2)}</td>
        </tr>
      `;
    });

    totalAmountSpan.textContent = total.toFixed(2);
    const payment = parseFloat(paymentInput.value) || 0;
    changeSpan.textContent = (payment - total >= 0 ? (payment - total).toFixed(2) : "0.00");
  }

  paymentInput.addEventListener("input", updateBillingTable);

  // Debounce variables
  let lastScanned = null;
  let lastScanTime = 0;
  const scanCooldown = 1500; // cooldown in milliseconds (1.5 seconds)

  startScanner((barcode) => {
    const now = Date.now();

    // Ignore if same barcode scanned within cooldown period
    if (barcode === lastScanned && (now - lastScanTime) < scanCooldown) {
      return;
    }

    lastScanned = barcode;
    lastScanTime = now;

    const product = getProduct(barcode);
    if (!product) {
      showMessage("❌ Product not found", "red");
      return;
    }

    const unitPrice = getEffectivePrice(product);
    if (bill[barcode]) {
      bill[barcode].quantity += 1;
    } else {
      bill[barcode] = {
        name: product.name,
        unitPrice,
        quantity: 1
      };
    }

    updateBillingTable();
    showMessage("✅ Product added to bill");
  });
}

function loadModifyMode() {
  appContent.innerHTML = `
    <h2>Modify Price</h2>
    <div id="scanner"></div>
    <div id="modifyProductInfo" style="margin-top: 20px;">
      <p>Scan a product barcode to modify prices.</p>
      <div id="modifyStatus" style="margin-bottom: 1rem;"></div>
      <form id="modifyForm" style="display: none;">
        <p><strong>Product:</strong> <span id="modProductName"></span></p>
        <p><strong>Current Permanent Price:</strong> <span id="modCurrentPrice"></span> DT</p>

        <label for="newPermanentPrice">New Permanent Price (DT):</label>
        <input type="number" id="newPermanentPrice" step="0.01" min="0" />

        <label for="tempPrice">Temporary Price (DT):</label>
        <input type="number" id="tempPrice" step="0.01" min="0" />

        <label for="tempPriceExpiry">Temporary Price Expiry Date:</label>
        <input type="date" id="tempPriceExpiry" />

        <button type="submit">Save Changes</button>
      </form>
    </div>
  `;

  let currentBarcode = null;
  let currentProduct = null;

  startScanner((barcode) => {
    if (barcode === currentBarcode) return;
    currentBarcode = barcode;

    const product = getProduct(barcode);
    const form = document.getElementById("modifyForm");
    const statusDiv = document.getElementById("modifyStatus");
    const nameSpan = document.getElementById("modProductName");
    const currentPriceSpan = document.getElementById("modCurrentPrice");

    if (!product) {
      form.style.display = "none";
      statusDiv.textContent = "❌ Product not found";
      showMessage("❌ Product not found", "red");
      currentProduct = null;
      return;
    }

    currentProduct = product;
    form.style.display = "block";
    statusDiv.textContent = "";
    nameSpan.textContent = product.name;
    currentPriceSpan.textContent = product.price.toFixed(2);

    // Pre-fill inputs with current values or empty
    document.getElementById("newPermanentPrice").value = product.price.toFixed(2);
    document.getElementById("tempPrice").value = product.tempPrice ? product.tempPrice.toFixed(2) : "";
    document.getElementById("tempPriceExpiry").value = product.tempPriceExpiry ? product.tempPriceExpiry.split("T")[0] : "";
    
    showMessage("✅ Product loaded. Modify prices and save.");
  });

  document.getElementById("modifyForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!currentProduct || !currentBarcode) return;

    const newPermPriceStr = document.getElementById("newPermanentPrice").value.trim();
    const tempPriceStr = document.getElementById("tempPrice").value.trim();
    const tempExpiryStr = document.getElementById("tempPriceExpiry").value;

    let newPermPrice = parseFloat(newPermPriceStr);
    if (isNaN(newPermPrice) || newPermPrice < 0) {
      showMessage("❌ Invalid permanent price", "red");
      return;
    }

    let tempPrice = null;
    if (tempPriceStr !== "") {
      tempPrice = parseFloat(tempPriceStr);
      if (isNaN(tempPrice) || tempPrice < 0) {
        showMessage("❌ Invalid temporary price", "red");
        return;
      }
    }

    // If temporary price given, expiry date is required
    if (tempPrice !== null && !tempExpiryStr) {
      showMessage("❌ Expiry date required for temporary price", "red");
      return;
    }

    // Validate expiry date if provided
    if (tempExpiryStr) {
      const expiryDate = new Date(tempExpiryStr);
      if (isNaN(expiryDate.getTime())) {
        showMessage("❌ Invalid expiry date", "red");
        return;
      }
      // Expiry must be in the future
      const now = new Date();
      now.setHours(0,0,0,0);
      if (expiryDate < now) {
        showMessage("❌ Expiry date must be in the future", "red");
        return;
      }
    }

    // Update product prices
    currentProduct.price = newPermPrice;
    if (tempPrice !== null) {
      currentProduct.tempPrice = tempPrice;
      currentProduct.tempPriceExpiry = tempExpiryStr;
    } else {
      delete currentProduct.tempPrice;
      delete currentProduct.tempPriceExpiry;
    }

    localStorage.setItem(currentBarcode, JSON.stringify(currentProduct));
    showMessage(`✅ Prices updated for "${currentProduct.name}"`);
  });
}


