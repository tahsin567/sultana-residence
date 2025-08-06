import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const supabaseUrl = 'https://thceadnlqdlivdxhzzdb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoY2VhZG5scWRsaXZkeGh6emRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMzOTI0NzAsImV4cCI6MjA2ODk2ODQ3MH0.nu7SJsrLzCxcr-9zTC4t485_8XDLACMglXW744rR4is';
const supabase = createClient(supabaseUrl, supabaseKey);

// DOM Elements
const bookingForm = document.getElementById('bookingForm');
const roomSelect = document.getElementById('roomSelect');
const roomsContainer = document.getElementById('roomsContainer');
const bookingStatus = document.getElementById('bookingStatus');
const lookupForm = document.getElementById('viewBookingForm');
const lookupStatus = document.getElementById('lookupStatus');
const lookupResultCard = document.getElementById('lookupResult');
const summaryCard = document.getElementById('bookingSummary');

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  loadRooms();
  if (bookingForm) bookingForm.addEventListener('submit', handleBookingSubmit);
  if (lookupForm) setupBookingLookup();
  document.getElementById('sendOtpBtn')?.addEventListener('click', handleSendOtp);
});

/* OTP Functions */
async function handleSendOtp() {
  const email = document.getElementById('guestEmail').value.trim();
  const phone = document.getElementById('guestPhone').value.trim();

  if (!email && !phone) {
    return updateStatus('Please provide email or phone number', 'danger');
  }

  updateStatus('Sending OTP...', 'info');
  
  try {
    const response = await fetch('/api/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, phone })
    });

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    const result = await response.json();

    if (result.success) {
      updateStatus('OTP sent successfully! Check your email/phone', 'success');
      document.getElementById('otpSection').style.display = 'block';
      
      // Initialize timer
      const otpTimer = document.getElementById('otpTimer');
      if (otpTimer) {
        startOtpCountdown(otpTimer);
      }
    } else {
      throw new Error(result.message || 'Failed to send OTP');
    }
  } catch (err) {
    console.error('OTP send error:', err);
    updateStatus(`Failed to send OTP: ${err.message}`, 'danger');
  }
}

function startOtpCountdown(otpTimer) {
  let timeLeft = 300; // 5 minutes in seconds
  otpTimer.style.display = 'block';
  otpTimer.style.color = ''; // Reset color
  
  const timer = setInterval(() => {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    otpTimer.textContent = `Code expires in: ${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    
    if (timeLeft <= 0) {
      clearInterval(timer);
      otpTimer.textContent = 'OTP expired. Please request a new one.';
      otpTimer.style.color = 'red';
    }
    timeLeft--;
  }, 1000);
}

/* Room Management Functions */
async function loadRooms() {
  if (!roomsContainer) return;
  roomsContainer.innerHTML = '<div class="loading-spinner">Loading rooms…</div>';
  
  try {
    const { data: rooms, error } = await supabase.from('rooms').select('*').eq('available', true);
    if (error) throw error;
    renderRooms(rooms);
  } catch (err) {
    roomsContainer.innerHTML = `
      <div class="alert alert-danger">
        Failed to load rooms. ${err.message}
        <button class="btn btn-sm btn-link" onclick="location.reload()">Try Again</button>
      </div>
    `;
  }
}

function renderRooms(rooms = []) {
  if (roomSelect) {
    roomSelect.innerHTML = `
      <option value="" disabled selected>Select Room Type</option>
      ${rooms.map(r => `
        <option value="${r.id}" data-price="${r.price}" data-capacity="${r.capacity}">
          ${r.name} ($${r.price}/night)
        </option>
      `).join('')}
    `;
  }

  if (!roomsContainer) return;
  roomsContainer.innerHTML = rooms.map(roomCardTemplate).join('');
  document.querySelectorAll('.room-book-btn').forEach(btn =>
    btn.addEventListener('click', () => handleRoomSelect(btn.dataset))
  );
}

function roomCardTemplate(room) {
  return `
    <div class="col-md-4 mb-4">
      <div class="card h-100">
        <img src="${room.image_url || 'images/default-room.jpg'}"
             class="card-img-top"
             alt="${room.name}"
             style="height:200px;object-fit:cover;">
        <div class="card-body">
          <h5 class="card-title">${room.name}</h5>
          <p class="card-text">${room.description}</p>
          <p><strong>$${room.price}/night</strong></p>
          <p>Capacity: ${room.capacity} person(s)</p>
          <button class="btn btn-dark room-book-btn"
                  data-room-id="${room.id}"
                  data-room-name="${room.name}"
                  data-room-price="${room.price}">
            Book Now
          </button>
        </div>
      </div>
    </div>
  `;
}

function handleRoomSelect({ roomId, roomName, roomPrice }) {
  if (roomSelect) roomSelect.value = roomId;
  const priceDisplay = document.getElementById('selectedRoomPrice');
  if (priceDisplay) priceDisplay.textContent = `$${roomPrice}/night`;
  updateStatus(`Selected: <strong>${roomName}</strong>`, 'info');
  document.getElementById('book')?.scrollIntoView({ behavior: 'smooth' });
}

async function handleBookingSubmit(e) {
  e.preventDefault();
  
  try {
    // Verify OTP if one was entered
    const otp = document.getElementById('otpCode')?.value.trim();
    if (otp) {
      const isValid = await verifyOtp();
      if (!isValid) return;
    }

    if (!roomSelect?.value) {
      return updateStatus('Please select a room type', 'danger');
    }

    const bookingData = {
      name: document.getElementById('guestName').value.trim(),
      email: document.getElementById('guestEmail').value.trim(),
      phone: document.getElementById('guestPhone').value.trim(),
      iqama_number: document.getElementById('guestIqama').value.trim(),
      room_id: roomSelect.value,
      checkin: document.getElementById('checkin').value,
      checkout: document.getElementById('checkout').value,
      special_requests: document.getElementById('specialRequests').value.trim()
    };

    // Validate required fields
    if (!bookingData.name || !bookingData.email || !bookingData.checkin || !bookingData.checkout) {
      return updateStatus('Please fill all required fields', 'danger');
    }

    updateStatus('Submitting booking request...', 'info');

    const response = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingData)
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Booking request failed');
    }

    updateStatus(`
      <h4>Booking Request Submitted!</h4>
      <p>We've sent a confirmation to your email.</p>
      <p>Your request ID: <strong>${result.booking.id}</strong></p>
      <p>We'll notify you once your booking is approved.</p>
    `, 'success');

    showBookingSummary(result.booking);
    bookingForm.reset();
    
    // Hide OTP section if visible
    const otpSection = document.getElementById('otpSection');
    if (otpSection) otpSection.style.display = 'none';
    
    const otpTimer = document.getElementById('otpTimer');
    if (otpTimer) otpTimer.style.display = 'none';
    
  } catch (err) {
    console.error('Booking error:', err);
    updateStatus(`
      <p>Booking request failed: ${err.message}</p>
      <p>Please try again or contact support.</p>
    `, 'danger');
  }
}

async function verifyOtp() {
  const email = document.getElementById('guestEmail').value.trim();
  const phone = document.getElementById('guestPhone').value.trim();
  const otp = document.getElementById('otpCode').value.trim();

  try {
    const response = await fetch('/api/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, phone, otp })
    });

    const result = await response.json();
    
    if (!result.success) {
      updateStatus(result.message || 'OTP verification failed', 'danger');
      return false;
    }
    
    return true;
  } catch (err) {
    console.error('OTP verification error:', err);
    updateStatus('Error verifying OTP', 'danger');
    return false;
  }
}

/* Utility Functions */
function updateStatus(message, type = 'danger') {
  if (bookingStatus) bookingStatus.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function showBookingSummary(booking) {
  if (!summaryCard) {
    console.error('Summary card element not found');
    return;
  }

  // Safely update each field only if the element exists
  const updateField = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value || 'N/A';
  };

  updateField('summaryRoom', booking.rooms?.name);
  updateField('summaryName', booking.name);
  updateField('summaryEmail', booking.email);
  updateField('summaryPhone', booking.phone);
  updateField('summaryIqama', booking.iqama_number);
  updateField('summaryCheckin', booking.checkin ? new Date(booking.checkin).toLocaleDateString() : '');
  updateField('summaryCheckout', booking.checkout ? new Date(booking.checkout).toLocaleDateString() : '');
  updateField('summaryId', booking.id);

  summaryCard.style.display = 'block';
}

async function setupBookingLookup() {
  if (!lookupForm) return;
  
  lookupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('lookupEmail').value.trim();
    const id = document.getElementById('lookupId').value.trim();

    if (!email && !id) {
      return setLookupStatus('Please enter either booking ID or email', 'danger');
    }

    setLookupStatus('Verifying access...', 'info');

    try {
      // If searching by email, require verification
      if (email && !id) {
        // Step 1: Send verification email
        const verificationResponse = await fetch('/api/verify-booking-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });

        if (!verificationResponse.ok) {
          throw new Error('Failed to connect to verification service');
        }

        const verificationResult = await verificationResponse.json();
        
        if (!verificationResult.success) {
          throw new Error(verificationResult.message || 'Failed to send verification email');
        }

        // Step 2: Get verification code from user
          const verificationCode = prompt(
            `A verification code has been sent to ${email}.\n` +
            `Please enter the code:`
        );
        if (!verificationCode) {
          throw new Error('Verification cancelled');
        }

        // Step 3: Verify the code
        const verifyResponse = await fetch('/api/verify-booking-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, token: verificationCode })
        });

        if (!verifyResponse.ok) {
          throw new Error('Verification service unavailable');
        }

        const verifyResult = await verifyResponse.json();
        
        if (!verifyResult.success) {
          throw new Error(verifyResult.message || 'Invalid verification code');
        }
      }

      // Proceed with booking lookup after verification
      let query = supabase.from('bookings').select('*, rooms(*)');
      query = id ? query.eq('id', id) : query.eq('email', email);

      const { data: bookings, error } = await query;
      if (error || !bookings?.length) throw new Error('No booking found');

      const booking = bookings[0];
      showBookingSummary(booking);
      setLookupStatus('Booking found!', 'success');
      
    } catch (err) {
      setLookupStatus(`Error: ${err.message}`, 'danger');
      console.error('Booking lookup error:', err);
    }
  });
}

function setLookupStatus(message, type = 'danger') {
  if (lookupStatus) lookupStatus.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

// Contact Form Handler
document.getElementById('contactForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('contactStatus');
  status.innerHTML = '<div class="alert alert-info">Sending message...</div>';

  try {
    const response = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('contactName').value.trim(),
        email: document.getElementById('contactEmail').value.trim(),
        message: document.getElementById('contactMessage').value.trim()
      })
    });

    // Handle non-OK responses
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.message || `Server error: ${response.status}`);
    }

    const result = await response.json();
    status.innerHTML = `<div class="alert alert-success">${result.message}</div>`;
    document.getElementById('contactForm').reset();

  } catch (err) {
    status.innerHTML = `<div class="alert alert-danger">Error: ${err.message}</div>`;
    console.error('Contact form error:', err);
  }
});