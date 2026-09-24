# Emergency Notification Setup (Free Implementation)

## Overview

The emergency notification system sends free SMS alerts and emails to configured emergency contacts using Gmail's SMTP service and carrier email-to-SMS gateways.

## Setup Instructions

### 1. Set Up Gmail Account

1. Use a Gmail account (or Google Workspace account)
2. Enable 2-factor authentication (2FA) on the account
3. Generate an App Password for the application:
   - Go to [Google Account Settings](https://myaccount.google.com/)
   - Security → 2-Step Verification → App passwords
   - Generate password for "Mail" application
   - Copy the 16-character password

### 2. Configure Environment Variables

Update `.env.local` with your Gmail credentials:

```env
GMAIL_USER=your-gmail-account@gmail.com
GMAIL_APP_PASSWORD=your-16-character-app-password
```

### 3. Configure Emergency Contacts

Update the emergency contacts in `src/db/index.ts` with real phone numbers and emails:

```typescript
const emergencyContactsData = [
  {
    id: 1,
    name: "Mom",
    phone: "+15551234567", // Replace with real phone number (US format)
    email: "mom@example.com", // Real email address
    relationship: "parent",
    isPrimary: true,
  },
  {
    id: 2,
    name: "Dad",
    phone: "+15552345678", // Replace with real phone number (US format)
    email: "dad@example.com", // Real email address
    relationship: "parent",
    isPrimary: true,
  },
];
```

**Important:** Phone numbers must be in E.164 format (e.g., +15551234567). The system will automatically try multiple carrier gateways to deliver SMS.

### 4. Test the System

1. Start the development server: `npm run dev`
2. Navigate to the home page
3. Click the red emergency button in the top-right
4. Select an emergency type and confirm
5. Check your Gmail sent folder to verify emails were sent
6. Check recipient SMS and email to confirm delivery

## How It Works

The system uses a **dual-notification approach** for maximum reliability:

1. **SMS via Email Gateways**: Converts emails to SMS using carrier-specific email addresses (free)
2. **Email Backup**: Sends HTML-formatted emergency emails (free via Gmail)

Supported carriers: AT&T, Verizon, T-Mobile, Sprint, and others.

## Security Notes

- Gmail App Passwords are used instead of main password - more secure
- Emergency contacts are currently stored in code - in production, move to secure database
- Environment variables are encrypted in production deployments
- Consider adding rate limiting to prevent abuse
- Add authentication to prevent unauthorized emergency alerts

## Limitations

- Currently supports US carriers only
- No delivery confirmations (emails may take 1-5 minutes to arrive as SMS)
- Gmail daily sending limits (500 emails/day for free accounts)
- Requires Gmail account with 2FA enabled

## Troubleshooting

- **"Service not configured"**: Check Gmail credentials in `.env.local`
- **"App password invalid"**: Regenerate App Password in Google Account settings
- **SMS not received**: Try different carrier, check phone number format (+15551234567)
- **Emails not sending**: Verify Gmail credentials and 2FA is enabled
- **Rate limited**: Gmail has sending limits; consider upgrading to paid email service if needed