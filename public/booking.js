const form = document.getElementById("bookingForm");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const roomSelect = document.getElementById('roomSelect');
  if (!roomSelect.value) {
    alert('Please select a room type');
    return;
  }

  const bookingData = {
    name: document.getElementById("guestName").value,
    email: document.getElementById("guestEmail").value,
    phone: document.getElementById("guestPhone").value,
    room_id: roomSelect.value,
    checkin: document.getElementById("checkin").value,
    checkout: document.getElementById("checkout").value
  };

  const status = document.getElementById("bookingStatus");
  
  try {
    const response = await fetch('/api/bookings', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bookingData)
    });

    const result = await response.json();
    
    if (result.success) {
      status.innerHTML = `<div class="alert alert-success">✅ Booking confirmed! ID: ${result.booking.id}</div>`;
      form.reset();
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    status.innerHTML = `<div class="alert alert-danger">❌ Booking failed: ${error.message}</div>`;
  }
});