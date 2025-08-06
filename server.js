import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import cors from 'cors';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const otpStore = new Map();
const verificationTokens = new Map();

app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());

// ============ OTP ============
app.post('/api/send-otp', async (req, res) => {
  try {
    const { email, phone } = req.body;
    if (!email && !phone) {
      return res.status(400).json({ success: false, message: 'Email or phone required' });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000;
    const key = phone ? `phone:${phone}` : `email:${email}`;
    otpStore.set(key, { otp, expiresAt });

    if (email) {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Your Sultana Residence Booking OTP',
        html: `<p>Your OTP code is: <strong>${otp}</strong></p>`,
      });
    }

    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    console.error('OTP send error:', err);
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
});

app.post('/api/verify-otp', (req, res) => {
  try {
    const { email, phone, otp } = req.body;
    const key = phone ? `phone:${phone}` : `email:${email}`;
    const stored = otpStore.get(key);

    if (!stored || stored.otp !== otp) {
      return res.json({ success: false, message: 'Invalid OTP' });
    }

    if (Date.now() > stored.expiresAt) {
      otpStore.delete(key);
      return res.json({ success: false, message: 'OTP expired' });
    }

    otpStore.delete(key);
    res.json({ success: true, message: 'OTP verified successfully' });
  } catch (err) {
    console.error('OTP verification error:', err);
    res.status(500).json({ success: false, message: 'OTP verification failed' });
  }
});

// ============ Rooms ============
let roomCache = null;
let cacheTimestamp = null;

app.get('/api/rooms', async (req, res) => {
  if (roomCache && Date.now() - cacheTimestamp < 5 * 60 * 1000) {
    return res.json({ success: true, data: roomCache, cached: true });
  }

  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('available', true)
      .order('price', { ascending: true });

    if (error) throw error;

    roomCache = data;
    cacheTimestamp = Date.now();
    res.json({ success: true, data, cached: false });
  } catch (err) {
    console.error('Room fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to load rooms' });
  }
});

// ============ Bookings ============
function calculateTotalPrice(checkin, checkout, nightlyRate) {
  const oneDay = 86400000;
  const nights = Math.round(Math.abs((new Date(checkin) - new Date(checkout)) / oneDay));
  return nights * nightlyRate;
}

/* ===================== */
/*       API Routes      */
/* ===================== */

// Enhanced Booking Endpoint
app.post('/api/bookings', async (req, res) => {
  try {
    // Validate required fields
    const requiredFields = ['name', 'email', 'phone', 'room_id', 'checkin', 'checkout'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    // Validate dates
    const checkin = new Date(req.body.checkin);
    const checkout = new Date(req.body.checkout);
    
    if (checkin >= checkout) {
      return res.status(400).json({
        success: false,
        message: 'Checkout date must be after checkin date'
      });
    }

    // Prepare booking data
    const bookingData = {
      ...req.body,
      status: 'pending',
      created_at: new Date().toISOString()
    };

    // Insert booking into database
    const { data, error } = await supabase
      .from('bookings')
      .insert([bookingData])
      .select('*, rooms:room_id(name)');
    
    if (error) throw error;

    const booking = data[0];
    const roomName = booking.rooms?.name || `Room ${booking.room_id}`;

    // Send emails (both admin notification and guest confirmation)
    try {
      await Promise.all([
        // Admin notification
        transporter.sendMail({
          from: `Sultana Residence <${process.env.EMAIL_USER}>`,
          to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
          subject: `New Booking Request #${booking.id}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2 style="color: #b8860b;">New Booking Request</h2>
              <p><strong>Booking ID:</strong> ${booking.id}</p>
              <p><strong>Guest:</strong> ${booking.name} (${booking.email})</p>
              <p><strong>Phone:</strong> ${booking.phone}</p>
              <p><strong>Room:</strong> ${roomName}</p>
              <p><strong>Dates:</strong> ${formatDate(booking.checkin)} to ${formatDate(booking.checkout)}</p>
              <p><strong>Status:</strong> <span style="color: #ffc107;">Pending Approval</span></p>
              <div style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px;">
                <p><strong>Special Requests:</strong></p>
                <p>${booking.special_requests || 'None'}</p>
              </div>
              <p style="margin-top: 20px;">
                <a href="${process.env.ADMIN_URL}/bookings/${booking.id}" 
                   style="background: #b8860b; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px;">
                  Review Booking
                </a>
              </p>
            </div>
          `
        }),
        
        // Guest confirmation
        transporter.sendMail({
          from: `Sultana Residence <${process.env.EMAIL_USER}>`,
          to: booking.email,
          subject: 'Your Booking Request Has Been Received',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2 style="color: #b8860b;">Booking Request Received</h2>
              <p>Dear ${booking.name},</p>
              <p>Thank you for your booking request at Sultana Residence.</p>
              
              <div style="margin: 20px 0; padding: 15px; border-left: 4px solid #b8860b; background: #f8f9fa;">
                <p><strong>Booking Reference:</strong> #${booking.id}</p>
                <p><strong>Room Type:</strong> ${roomName}</p>
                <p><strong>Dates:</strong> ${formatDate(booking.checkin)} - ${formatDate(booking.checkout)}</p>
                <p><strong>Status:</strong> Pending Approval</p>
              </div>
              
              <p>We're currently reviewing your request and will notify you via email once it's processed.</p>
              <p>For any questions, please reply to this email or contact us at ${process.env.CONTACT_PHONE}.</p>
              
              <p>Best regards,<br>The Sultana Residence Team</p>
            </div>
          `
        })
      ]);
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      // Don't fail the booking if emails fail
    }

res.json({
  success: true,
  booking: {
    id: booking.id,
    name: booking.name,
    email: booking.email,
    phone: booking.phone,
    iqama_number: booking.iqama_number,
    status: booking.status,
    room: booking.rooms?.name || `Room ${booking.room_id}`,
    checkin: booking.checkin,
    checkout: booking.checkout
  },
  message: 'Booking request submitted successfully. Please check your email for confirmation.'
});


  } catch (err) {
    console.error('Booking creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking request',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Helper function to format dates
function formatDate(dateString) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return new Date(dateString).toLocaleDateString('en-US', options);
}

// ============ Booking Verification ============
app.post('/api/verify-booking-access', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  const token = crypto.randomInt(100000, 999999).toString();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  verificationTokens.set(email, { token, expiresAt });

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your Booking Verification Code',
      html: `<p>Your verification code is <strong>${token}</strong>. It will expire in 5 minutes.</p>`
    });

    res.json({ success: true, message: 'Verification email sent' });
  } catch (err) {
    console.error('Verification send error:', err);
    res.status(500).json({ success: false, message: 'Failed to send verification code' });
  }
});

app.post('/api/verify-booking-token', (req, res) => {
  const { email, token } = req.body;
  const stored = verificationTokens.get(email);

  if (!stored || stored.token !== token) {
    return res.json({ success: false, message: 'Invalid token' });
  }

  if (Date.now() > stored.expiresAt) {
    verificationTokens.delete(email);
    return res.json({ success: false, message: 'Token expired' });
  }

  verificationTokens.delete(email);
  res.json({ success: true, message: 'Token verified' });
});

// ============ Contact Form ============
app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }

  try {
    // Email to you
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: `New Contact from ${name}`,
      html: `
        <h2>New Message</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Message:</strong></p>
        <p>${message.replace(/\n/g, '<br>')}</p>
      `
    });

    // Confirmation email to user
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: `Thank you for contacting Sultana Residence`,
      html: `
        <p>Hi ${name},</p>
        <p>Thank you for your message. We will reply soon.</p>
        <blockquote>${message.replace(/\n/g, '<br>')}</blockquote>
        <p>Sincerely,<br/>Sultana Residence</p>
      `
    });

    res.json({ success: true, message: 'Message sent successfully' });
  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ success: false, message: 'Failed to send message' });
  }
});

// ============ Static Files & Error Handling ============
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
