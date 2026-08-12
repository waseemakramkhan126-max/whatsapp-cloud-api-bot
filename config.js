module.exports = {
    // Phase 1: Debounce
    DEBOUNCE_TIME: 3000, // 3 seconds

    // Phase 2: Queue & Rate Limiting
    INTER_MESSAGE_DELAY: () => Math.random() * 1700 + 800, // 0.8 - 2.5 sec
    DAILY_MSG_CAP: 150, // naye account ke liye (abhi code mein cap logic fully nahi, placeholder)

    // Phase 3: Human-like Reply
    SMART_DELAY: () => Math.random() * 3000 + 1000, // 1-4 sec
    SHORT_TEXT_THRESHOLD: 50,  // characters
    LONG_TEXT_THRESHOLD: 100,  // characters
    SHORT_TYPING_TIME: () => Math.random() * 1000 + 2000, // 2-3 sec
    LONG_TYPING_TIME: () => Math.random() * 2000 + 3000,  // 3-5 sec

    // Phase 4: Dead-end keywords (Grey tick ke liye)
    DEAD_END_KEYWORDS: ['ok', 'thanks', 'thank you', '👍', '🙏', 'shukriya', 'thik hai'],

    // Phase 5: Chunking
    CHUNK_SIZE: 200, // characters
    CHUNK_GAP: 1500, // ms

    // Phase 6: Night Mode
    NIGHT_START_HOUR: 0,   // 12 AM
    NIGHT_END_HOUR: 8,     // 8 AM
    NIGHT_REPLY_TEXT: "Maaf kijiye, hamari service abhi band hai. Subah 8 baje open hogi.",

    // AI Endpoint (badal dein apne Supabase edge function se)
    AI_ENDPOINT: 'https://hkabhikizdlbavfkualt.supabase.co/functions/v1/chat-brain',
    // 🔑 SUPABASE REALTIME CREDENTIALS (Yeh Nayi Lines Add Karein)
    SUPABASE_URL: 'https://hkabhikizdlbavfkualt.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrYWJoaWtpemRsYmF2Zmt1YWx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0ODgyMjUsImV4cCI6MjA5MjA2NDIyNX0.iMlS6-M1aylW8K915LPYDHOg7qUxwu5GelH_CPHLP2U' // Yahan apni Supabase ki Anon Key paste karein
};