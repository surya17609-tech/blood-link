/* global L */
const pageViews = document.querySelectorAll(".page-view");
let currentAuthMode = "signup";
let leafletMap = null;
let isLoggedIn = false;
let hospitalMarkersLayer = null;

let userRequests = [];
let storedGeminiApiKey = "";

let bloodChatHistory = [
  { role: "assistant", content: "Hello! I'm <strong>Blood</strong>, your AI health assistant. I am connected live to Gemini AI. Ask me anything about blood compatibility, donor guidelines, or medical questions!" }
];

function setupNavLinks() {
  document.querySelectorAll(".nav-link").forEach(link => {
    const newLink = link.cloneNode(true);
    link.parentNode.replaceChild(newLink, link);
  });

  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = link.getAttribute("data-target");

      if (isLoggedIn && (targetId === "signup-view" || targetId === "login-view")) {
        return;
      }

      pageViews.forEach(view => {
        view.classList.remove("active");
      });

      const targetView = document.getElementById(targetId);
      if (targetView) {
        targetView.classList.add("active");
        window.scrollTo({ top: 0, behavior: "smooth" });

        if (targetId === "map-view") {
          setTimeout(initOpenStreetMapWithLiveAPI, 150);
        } else if (targetId === "request-page-view") {
          renderUserRequests();
        } else if (targetId === "create-request-view") {
          const editIdx = document.getElementById("editRequestIndex").value;
          if (editIdx === "") {
            document.getElementById("newBloodReqForm").reset();
            document.getElementById("reqFormEyebrow").textContent = "NEW REQUEST";
            document.getElementById("reqFormTitle").textContent = "Post Blood Need";
            document.getElementById("reqSubmitBtnText").textContent = "Post Request →";
          }
        }
      }

      const navMenu = document.getElementById("navMenu");
      if (navMenu) navMenu.classList.remove("open");
    });
  });
}

function updateNavbarState() {
  const linksContainer = document.getElementById("navLinksContainer");
  const authArea = document.getElementById("navAuthArea");

  if (!linksContainer || !authArea) return;

  if (isLoggedIn) {
    linksContainer.innerHTML = `
      <a href="#" class="nav-link" data-target="map-view">Home</a>
      <a href="#" class="nav-link" data-target="request-page-view">Request</a>
      <a href="#" class="nav-link" data-target="donate-view">Donate</a>
    `;
    authArea.innerHTML = `
      <a href="#" class="nav-link nav-button" data-target="ask-blood-view">Ask Blood</a>
    `;
  } else {
    linksContainer.innerHTML = `
      <a href="#" class="nav-link" data-target="home-view">Home</a>
    `;
    authArea.innerHTML = `
      <a href="#" class="nav-link auth-trigger" data-mode="signup">Sign Up</a>
      <a href="#" class="nav-link nav-button auth-trigger" data-mode="login">Log In</a>
    `;
  }

  setupNavLinks();
  setupAuthTriggers();
}

function setupAuthTriggers() {
  document.querySelectorAll(".auth-trigger").forEach(trigger => {
    trigger.addEventListener("click", (e) => {
      e.preventDefault();

      if (isLoggedIn) return;

      const mode = trigger.getAttribute("data-mode") || "signup";
      currentAuthMode = mode;

      const titleEl = document.getElementById("authFormTitle");
      const subtitleEl = document.getElementById("authFormSubtitle");
      const extraFields = document.getElementById("signUpExtraFields");
      const addressWrapper = document.getElementById("addressFieldWrapper");
      const submitBtn = document.getElementById("authSubmitBtn");
      const signupForm = document.getElementById("signupForm");
      const otpSection = document.getElementById("otpSection");

      if (signupForm) signupForm.reset();
      if (otpSection) otpSection.classList.add("hidden-group");
      document.getElementById("signupMessage").textContent = "";
      const sendOtpBtn = document.getElementById("sendOtpBtn");
      sendOtpBtn.textContent = "Send OTP";
      sendOtpBtn.disabled = false;

      if (mode === "login") {
        if (titleEl) titleEl.textContent = "Welcome Back";
        if (subtitleEl) subtitleEl.textContent = "Enter your phone number to log in";
        if (extraFields) extraFields.style.display = "none";
        if (addressWrapper) addressWrapper.style.display = "none";
        if (submitBtn) submitBtn.textContent = "Log In →";
      } else {
        if (titleEl) titleEl.textContent = "Create Your Account";
        if (subtitleEl) subtitleEl.textContent = "Please enter your details to sign up";
        if (extraFields) extraFields.style.display = "block";
        if (addressWrapper) addressWrapper.style.display = "block";
        if (submitBtn) submitBtn.textContent = "Continue →";
      }

      pageViews.forEach(view => view.classList.remove("active"));
      document.getElementById("signup-view").classList.add("active");
      window.scrollTo({ top: 0, behavior: "smooth" });

      const navMenu = document.getElementById("navMenu");
      if (navMenu) navMenu.classList.remove("open");
    });
  });
}

function fetchHospitalsFromOverpass() {
  if (!leafletMap) return;

  const bounds = leafletMap.getBounds();
  const south = bounds.getSouth();
  const west = bounds.getWest();
  const north = bounds.getNorth();
  const east = bounds.getEast();

  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="hospital"](${south},${west},${north},${east});
      way["amenity"="hospital"](${south},${west},${north},${east});
      relation["amenity"="hospital"](${south},${west},${north},${east});
      node["amenity"="blood_bank"](${south},${west},${north},${east});
      way["amenity"="blood_bank"](${south},${west},${north},${east});
      relation["amenity"="blood_bank"](${south},${west},${north},${east});
      node["healthcare"="hospital"](${south},${west},${north},${east});
      node["healthcare"="blood_bank"](${south},${west},${north},${east});
    );
    out body;
    >;
    out skel qt;
  `;

  const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query);

  fetch(url)
    .then(response => response.json())
    .then(data => {
      if (!data || !data.elements) return;

      if (hospitalMarkersLayer) {
        leafletMap.removeLayer(hospitalMarkersLayer);
      }
      hospitalMarkersLayer = L.layerGroup();

      data.elements.forEach(element => {
        let lat = element.lat;
        let lon = element.lon;

        if (!lat && element.center) {
          lat = element.center.lat;
          lon = element.center.lon;
        }

        if (lat && lon) {
          const tags = element.tags || {};
          const name = tags.name || tags['name:en'] || "Medical Facility / Blood Bank";
          const type = tags.amenity === 'blood_bank' || tags.healthcare === 'blood_bank' ? 'Blood Bank' : 'Hospital';
          const phone = tags.phone || tags['contact:phone'] || "Emergency Services Available";

          const marker = L.marker([lat, lon]);
          marker.bindPopup(`
            <div style="font-family: Inter, sans-serif; min-width: 170px;">
              <b style="color: #e63946; font-size: 14px;">${name}</b><br>
              <span style="font-size: 12px; color: #555;">📍 ${type}</span><br>
              <span style="font-size: 11px; color: #333;">📞 ${phone}</span>
            </div>
          `);

          hospitalMarkersLayer.addLayer(marker);
        }
      });

      hospitalMarkersLayer.addTo(leafletMap);
    })
    .catch(err => console.warn("Overpass API fetch error:", err));
}

function initOpenStreetMapWithLiveAPI() {
  const mapElement = document.getElementById("googleMap");
  if (!mapElement) return;

  if (leafletMap !== null) {
    leafletMap.invalidateSize();
    fetchHospitalsFromOverpass();
    return;
  }

  if (typeof L !== 'undefined') {
    let defaultLat = 11.1271;
    let defaultLng = 78.6569;

    leafletMap = L.map('googleMap').setView([defaultLat, defaultLng], 13);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(leafletMap);

    const redMarkerIcon = L.divIcon({
      className: 'custom-red-pin',
      html: '<div style="background-color: #e63946; width: 22px; height: 22px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 15px rgba(230, 57, 70, 0.95);"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userLat = position.coords.latitude;
          const userLng = position.coords.longitude;

          leafletMap.setView([userLat, userLng], 14);

          L.marker([userLat, userLng], { icon: redMarkerIcon }).addTo(leafletMap)
            .bindPopup('<b>🔴 Your Live GPS Location</b><br>You are here')
            .openPopup();

          setTimeout(fetchHospitalsFromOverpass, 500);
        },
        () => setTimeout(fetchHospitalsFromOverpass, 500)
      );
    } else {
      setTimeout(fetchHospitalsFromOverpass, 500);
    }

    leafletMap.on('moveend', () => fetchHospitalsFromOverpass());
  }
}

const menuToggle = document.getElementById("menuToggle");
if (menuToggle) {
  menuToggle.addEventListener("click", () => {
    document.getElementById("navMenu").classList.toggle("open");
  });
}

let generatedOtp = "";
const sendOtpBtn = document.getElementById("sendOtpBtn");
const otpSection = document.getElementById("otpSection");
const otpHint = document.getElementById("otpHint");
const signupForm = document.getElementById("signupForm");
const signupMessage = document.getElementById("signupMessage");

let otpTimerInterval = null;

if (sendOtpBtn) {
  sendOtpBtn.addEventListener("click", () => {
    const phoneNum = document.getElementById("phoneNum").value.trim();
    if (phoneNum.length < 10) {
      alert("Please enter a valid 10-digit phone number first.");
      return;
    }

    generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    otpSection.classList.remove("hidden-group");
    otpHint.textContent = `[Demo OTP sent to ${phoneNum}: ${generatedOtp}]`;

    let timeLeft = 60;
    sendOtpBtn.disabled = true;
    sendOtpBtn.textContent = `Resend in ${timeLeft}s`;

    if (otpTimerInterval) clearInterval(otpTimerInterval);

    otpTimerInterval = setInterval(() => {
      timeLeft--;
      if (timeLeft > 0) {
        sendOtpBtn.textContent = `Resend in ${timeLeft}s`;
      } else {
        clearInterval(otpTimerInterval);
        sendOtpBtn.disabled = false;
        sendOtpBtn.textContent = "Send OTP";
      }
    }, 1000);
  });
}

if (signupForm) {
  signupForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const enteredOtp = document.getElementById("otpInput").value.trim();
    const fullName = document.getElementById("fullName").value.trim() || "User";

    if (!generatedOtp || enteredOtp !== generatedOtp) {
      signupMessage.style.color = "var(--red)";
      signupMessage.textContent = "Please enter the correct verification OTP.";
      return;
    }

    signupMessage.style.color = "#26aa70";
    signupMessage.textContent = currentAuthMode === "login" ? "Logged in successfully! Redirecting..." : "Verified successfully! Redirecting...";

    setTimeout(() => {
      signupForm.reset();
      otpSection.classList.add("hidden-group");
      signupMessage.textContent = "";
      sendOtpBtn.textContent = "Send OTP";
      sendOtpBtn.disabled = false;
      if (otpTimerInterval) clearInterval(otpTimerInterval);

      isLoggedIn = true;
      updateNavbarState();

      document.getElementById("userWelcomeTitle").textContent = `Welcome, ${fullName}!`;
      pageViews.forEach(v => v.classList.remove("active"));
      document.getElementById("dashboard-view").classList.add("active");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 1200);
  });
}

const requestForm = document.getElementById("requestForm");
if (requestForm) {
  requestForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formMessage = document.getElementById("formMessage");
    const requestId = "BL-" + Math.random().toString(36).slice(2, 8).toUpperCase();

    if (formMessage) {
      formMessage.style.color = "#26aa70";
      formMessage.textContent = `Request ${requestId} submitted successfully! We are notifying nearby donors.`;
    }
    requestForm.reset();
  });
}

function renderUserRequests() {
  const feedList = document.getElementById("userRequestsFeedList");
  const notice = document.getElementById("noUserRequestsNotice");
  if (!feedList) return;

  feedList.innerHTML = "";

  if (userRequests.length === 0) {
    if (notice) notice.style.display = "block";
    return;
  }

  if (notice) notice.style.display = "none";

  userRequests.forEach((req, index) => {
    const card = document.createElement("div");
    card.className = "user-request-card";
    card.innerHTML = `
      <div class="user-req-header">
        <h3 style="font-size: 16px; color: var(--black);">Patient: <span>${req.name}</span></h3>
        <div class="user-req-actions">
          <button class="btn btn-sm btn-edit" onclick="editUserRequest(${index})">Edit</button>
          <button class="btn btn-sm btn-delete" onclick="deleteUserRequest(${index})">Delete</button>
        </div>
      </div>
      <p style="font-size: 13px; color: var(--muted);">🩸 Blood type needed: <strong>${req.bloodTypeDisplay}</strong> &nbsp;|&nbsp; 📦 Units: <strong>${req.units}</strong></p>
      <p style="font-size: 13px; color: var(--muted);">🏥 Hospital: ${req.hospital}</p>
      <p style="font-size: 13px; color: var(--muted);">📍 District: ${req.district} (${req.distance})</p>
      <p style="font-size: 13px; color: var(--black);">📞 Phone: ${req.phone}</p>
    `;
    feedList.appendChild(card);
  });
}

window.editUserRequest = function(index) {
  const req = userRequests[index];
  if (!req) return;

  document.getElementById("editRequestIndex").value = index;
  document.getElementById("newReqName").value = req.name;
  document.getElementById("newReqPhone").value = req.phone;
  document.getElementById("newReqBloodType").value = req.bloodTypeDisplay;
  document.getElementById("newReqUnits").value = req.units;
  document.getElementById("newReqHospital").value = req.hospital;
  document.getElementById("newReqDistrict").value = req.district;
  document.getElementById("newReqDistance").value = req.distance;

  document.getElementById("reqFormEyebrow").textContent = "EDIT REQUEST";
  document.getElementById("reqFormTitle").textContent = "Update Blood Requirement";
  document.getElementById("reqSubmitBtnText").textContent = "Save Changes →";

  pageViews.forEach(v => v.classList.remove("active"));
  document.getElementById("create-request-view").classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

window.deleteUserRequest = function(index) {
  if (confirm("Are you sure you want to delete this emergency request?")) {
    userRequests.splice(index, 1);
    renderUserRequests();
  }
};

const newBloodReqForm = document.getElementById("newBloodReqForm");
if (newBloodReqForm) {
  newBloodReqForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const editIdx = document.getElementById("editRequestIndex").value;
    const name = document.getElementById("newReqName").value.trim();
    const phone = document.getElementById("newReqPhone").value.trim();
    const bloodTypeDisplay = document.getElementById("newReqBloodType").value;
    const bloodType = bloodTypeDisplay.toLowerCase();
    const units = document.getElementById("newReqUnits").value;
    const hospital = document.getElementById("newReqHospital").value.trim();
    const district = document.getElementById("newReqDistrict").value.trim();
    const distance = document.getElementById("newReqDistance").value.trim() || "Within 5 km";
    const msg = document.getElementById("newReqMessage");

    const reqData = { name, phone, bloodTypeDisplay, bloodType, units, hospital, district, distance };

    if (editIdx !== "") {
      userRequests[parseInt(editIdx)] = reqData;
      msg.style.color = "#26aa70";
      msg.textContent = "Request updated successfully! Redirecting...";
    } else {
      userRequests.unshift(reqData);

      const donateFeed = document.getElementById("donateFeedContainer");
      if (donateFeed) {
        const donateCard = document.createElement("div");
        donateCard.className = "signup-box donate-patient-card";
        donateCard.style.maxWidth = "100%";
        donateCard.setAttribute("data-name", name.toLowerCase());
        donateCard.setAttribute("data-blood", bloodType);
        donateCard.setAttribute("data-district", district.toLowerCase());
        donateCard.innerHTML = `
          <span class="eyebrow" style="color: var(--red);">NEW EMERGENCY REQUEST</span>
          <h3 style="margin: 8px 0 10px;">Patient: ${name}</h3>
          <p style="font-size: 14px; color: #444; margin-bottom: 6px;">🩸 Blood type needed: <strong>${bloodTypeDisplay}</strong> &nbsp;|&nbsp; 📦 Units: <strong>${units}</strong></p>
          <p style="font-size: 13px; color: var(--muted); margin-bottom: 4px;">🏥 Hospital: ${hospital}</p>
          <p style="font-size: 13px; color: var(--muted); margin-bottom: 4px;">📍 Address: ${district} (${distance})</p>
          <p style="font-size: 13px; color: var(--black); margin-top: 6px;">📞 Phone: ${phone}</p>
          <button class="btn btn-primary accept-donate-btn" style="margin-top: 15px; width: 100%;">Accept Request</button>
        `;
        donateFeed.prepend(donateCard);
        attachAcceptButtonListeners();
      }

      msg.style.color = "#26aa70";
      msg.textContent = "Emergency request posted successfully! Redirecting...";
    }

    setTimeout(() => {
      newBloodReqForm.reset();
      document.getElementById("editRequestIndex").value = "";
      msg.textContent = "";
      pageViews.forEach(v => v.classList.remove("active"));
      document.getElementById("request-page-view").classList.add("active");
      renderUserRequests();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 1000);
  });
}

function attachAcceptButtonListeners() {
  document.querySelectorAll(".accept-donate-btn").forEach(btn => {
    btn.onclick = function() {
      this.style.background = "#26aa70";
      this.textContent = "✓ Accepted! Connecting to Patient...";
      this.disabled = true;
    };
  });
}
attachAcceptButtonListeners();

function applyDonateFilters() {
  const query = document.getElementById("donateSearchInput").value.toLowerCase().trim();
  const selectedGroup = document.getElementById("donateFilterDropdown").value.toLowerCase().trim();
  const cards = document.querySelectorAll(".donate-patient-card");

  cards.forEach(card => {
    const name = card.getAttribute("data-name") || "";
    const blood = card.getAttribute("data-blood") || "";
    const district = card.getAttribute("data-district") || "";

    const matchesSearch = name.includes(query) || blood.includes(query) || district.includes(query);
    const matchesGroup = (selectedGroup === "all") || (blood === selectedGroup);

    if (matchesSearch && matchesGroup) {
      card.style.display = "block";
    } else {
      card.style.display = "none";
    }
  });
}

const donateSearchInput = document.getElementById("donateSearchInput");
const donateFilterDropdown = document.getElementById("donateFilterDropdown");

if (donateSearchInput) donateSearchInput.addEventListener("input", applyDonateFilters);
if (donateFilterDropdown) donateFilterDropdown.addEventListener("change", applyDonateFilters);

const toggleKeyModalBtn = document.getElementById("toggleKeyModalBtn");
const apiKeyBar = document.getElementById("apiKeyBar");
const saveApiKeyBtn = document.getElementById("saveApiKeyBtn");
const geminiApiKeyInput = document.getElementById("geminiApiKeyInput");
const botStatusSubtitle = document.getElementById("botStatusSubtitle");

if (toggleKeyModalBtn && apiKeyBar) {
  toggleKeyModalBtn.addEventListener("click", () => {
    apiKeyBar.classList.toggle("hidden-group");
  });
}

if (saveApiKeyBtn && geminiApiKeyInput) {
  saveApiKeyBtn.addEventListener("click", () => {
    storedGeminiApiKey = geminiApiKeyInput.value.trim();
    if (botStatusSubtitle) {
      botStatusSubtitle.textContent = storedGeminiApiKey ? "Gemini Live API Active ✓" : "Powered by Gemini AI Engine";
    }
    apiKeyBar.classList.add("hidden-group");
    alert("Gemini API Key updated successfully!");
  });
}

const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatMessages = document.getElementById("chatMessages");

function renderChatHistory() {
  if (!chatMessages) return;
  chatMessages.innerHTML = "";
  bloodChatHistory.forEach(msg => {
    const div = document.createElement("div");
    div.className = msg.role === "assistant" ? "chat-msg bot-msg" : "chat-msg user-msg";
    div.innerHTML = msg.content;
    chatMessages.appendChild(div);
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

if (chatForm) {
  renderChatHistory();

  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;

    bloodChatHistory.push({ role: "user", content: text });
    renderChatHistory();
    chatInput.value = "";

    const typingDiv = document.createElement("div");
    typingDiv.className = "chat-msg bot-msg";
    typingDiv.id = "typingIndicator";
    typingDiv.innerHTML = "<em>Blood is thinking...</em>";
    chatMessages.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (storedGeminiApiKey) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${storedGeminiApiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `You are Blood, a compassionate AI assistant for Blood Link. Answer concisely: ${text}` }] }]
          })
        });
        const data = await response.json();
        const el = document.getElementById("typingIndicator");
        if (el) el.remove();

        let aiResponse = "I'm having trouble connecting to Gemini API. Please check your network connection.";
        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
          aiResponse = data.candidates[0].content.parts[0].text;
        }

        bloodChatHistory.push({ role: "assistant", content: aiResponse });
        renderChatHistory();
        return;
      } catch (err) {
        console.warn("Gemini API Error:", err);
      }
    }

    setTimeout(() => {
      const el = document.getElementById("typingIndicator");
      if (el) el.remove();

      const lower = text.toLowerCase();
      let responseText = "";

      if (lower.includes("what can you do") || lower.includes("help")) {
        responseText = "I am <strong>Blood</strong>, your medical AI assistant! I answer queries regarding blood types, transfusion eligibility, and local blood banks.";
      } else if (lower.includes("compatibility") || lower.includes("match")) {
        responseText = "Blood compatibility summary:<br>• **O-**: Universal red blood cell donor.<br>• **AB+**: Universal red cell recipient & plasma donor.<br>• **A+ / B+**: Can donate to their type & AB+.";
      } else if (lower.includes("eligibility") || lower.includes("can i donate")) {
        responseText = "Standard eligibility: Age 18–65, weight > 50kg, good health, and no major surgeries in the last 6 months.";
      } else {
        responseText = `Regarding "${text}": Stay hydrated, contact verified donors via Blood Link, and consult a qualified medical professional for specific health advice!`;
      }

      bloodChatHistory.push({ role: "assistant", content: responseText });
      renderChatHistory();
    }, 600);
  });
}

updateNavbarState();