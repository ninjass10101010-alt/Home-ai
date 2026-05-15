# Free SMS and Email Services for Emergency Notifications

## Overview
For emergency notifications, we need reliable outbound communication. Here are free/low-cost options that work well for this use case.

## SMS Options

### 1. Email-to-SMS Gateways (Completely Free)
Convert emails to SMS using carrier-specific email addresses. Most reliable for emergency use.

**Pros:** Free, no API keys needed, works with any email service
**Cons:** Limited to US carriers, no delivery confirmation, rate limits

**Implementation:**

```typescript
// src/lib/sms-gateways.ts
export const smsGateways = {
  // Major US carriers
  'att': '@txt.att.net',           // AT&T
  'verizon': '@vtext.com',         // Verizon
  'tmobile': '@tmomail.net',       // T-Mobile
  'sprint': '@messaging.sprintpcs.com', // Sprint
  'virgin': '@vmobl.com',          // Virgin Mobile
  'cricket': '@sms.cricketwireless.net', // Cricket
  'metropcs': '@mymetropcs.com',   // MetroPCS
  'straighttalk': '@vtext.com',    // Straight Talk (uses Verizon)
  'boost': '@sms.myboostmobile.com', // Boost Mobile
};

export async function sendSMSViaEmail(phoneNumber: string, message: string, carrier?: string) {
  // If carrier unknown, try common ones
  const carriers = carrier ? [carrier] : ['att', 'verizon', 'tmobile'];

  for (const carrierKey of carriers) {
    const gateway = smsGateways[carrierKey as keyof typeof smsGateways];
    if (!gateway) continue;

    const emailAddress = `${phoneNumber}${gateway}`;

    try {
      const response = await fetch('/api/send-email-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: emailAddress,
          subject: 'Emergency Alert',
          message: message.substring(0, 160), // SMS length limit
        }),
      });

      if (response.ok) {
        console.log(`SMS sent via ${carrierKey} to ${phoneNumber}`);
        return { success: true, carrier: carrierKey };
      }
    } catch (error) {
      console.error(`Failed to send via ${carrierKey}:`, error);
    }
  }

  return { success: false, error: 'All carriers failed' };
}
```

### 2. AWS SNS (Free Tier: 100 SMS/month for 12 months)
Amazon Simple Notification Service with generous free tier.

**Pros:** Reliable, global coverage, delivery receipts
**Cons:** Requires AWS account, free tier expires after 12 months

**Setup:**
1. Create AWS account
2. Enable SNS in AWS Console
3. Get access keys
4. Add to `.env.local`:
```env
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1
```

**Implementation:**
```bash
bun add @aws-sdk/client-sns
```

```typescript
// src/lib/aws-sms.ts
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const snsClient = new SNSClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function sendSMSViaAWS(phoneNumber: string, message: string) {
  try {
    const command = new PublishCommand({
      PhoneNumber: phoneNumber,
      Message: message,
      MessageAttributes: {
        'AWS.SNS.SMS.SenderID': {
          DataType: 'String',
          StringValue: 'Emergency'
        }
      }
    });

    const result = await snsClient.send(command);
    return { success: true, messageId: result.MessageId };
  } catch (error) {
    console.error('AWS SMS failed:', error);
    return { success: false, error: error.message };
  }
}
```

### 3. Textbelt (1 free SMS/day for testing)
Good for development/testing, not for production emergencies.

```typescript
// src/lib/textbelt-sms.ts
export async function sendSMSViaTextbelt(phoneNumber: string, message: string) {
  const response = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: phoneNumber,
      message: message,
      key: 'textbelt' // Free tier key
    }),
  });

  const result = await response.json();
  return result;
}
```

## Email Options

### 1. SendGrid (100 emails/day free)
Industry standard, very reliable for emergency communications.

**Setup:**
1. Create SendGrid account at sendgrid.com
2. Verify single sender email
3. Get API key from dashboard
4. Add to `.env.local`:
```env
SENDGRID_API_KEY=your_api_key_here
FROM_EMAIL=your-verified@email.com
```

**Implementation:**
```bash
bun add @sendgrid/mail
```

```typescript
// src/lib/sendgrid-email.ts
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

export async function sendEmail(to: string, subject: string, text: string, html?: string) {
  const msg = {
    to,
    from: process.env.FROM_EMAIL!,
    subject,
    text,
    html: html || text,
  };

  try {
    await sgMail.send(msg);
    return { success: true };
  } catch (error) {
    console.error('SendGrid email failed:', error);
    return { success: false, error: error.message };
  }
}
```

### 2. Resend (3,000 emails/month free)
Modern email service with great developer experience.

**Setup:**
1. Create account at resend.com
2. Get API key
3. Verify domain or single sender
4. Add to `.env.local`:
```env
RESEND_API_KEY=your_api_key_here
FROM_EMAIL=your-verified@email.com
```

**Implementation:**
```bash
bun add resend
```

```typescript
// src/lib/resend-email.ts
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(to: string, subject: string, text: string, html?: string) {
  try {
    const data = await resend.emails.send({
      from: process.env.FROM_EMAIL!,
      to: [to],
      subject,
      text,
      html: html || text,
    });

    return { success: true, id: data.id };
  } catch (error) {
    console.error('Resend email failed:', error);
    return { success: false, error: error.message };
  }
}
```

### 3. Gmail SMTP (500 emails/day free)
Use Gmail's SMTP servers directly.

**Setup:**
1. Enable 2FA on Gmail account
2. Generate App Password
3. Add to `.env.local`:
```env
GMAIL_USER=your@gmail.com
GMAIL_APP_PASSWORD=your_app_password
```

**Implementation:**
```bash
bun add nodemailer
```

```typescript
// src/lib/gmail-smtp.ts
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export async function sendEmail(to: string, subject: string, text: string, html?: string) {
  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject,
      text,
      html: html || text,
    });

    return { success: true };
  } catch (error) {
    console.error('Gmail SMTP failed:', error);
    return { success: false, error: error.message };
  }
}
```

## Recommended Implementation Strategy

For emergency notifications, use a **fallback chain** of services:

```typescript
// src/lib/emergency-notification.ts
export async function sendEmergencyAlert(phoneNumber: string, email: string, message: string) {
  const results = [];

  // Try SMS first (most immediate)
  try {
    const smsResult = await sendSMSViaEmail(phoneNumber, message);
    results.push({ method: 'SMS', ...smsResult });
    if (smsResult.success) return results;
  } catch (error) {
    results.push({ method: 'SMS', success: false, error: error.message });
  }

  // Fallback to email
  try {
    const emailResult = await sendEmail(email, 'EMERGENCY ALERT', message);
    results.push({ method: 'Email', ...emailResult });
  } catch (error) {
    results.push({ method: 'Email', success: false, error: error.message });
  }

  return results;
}
```

## API Route Integration

```typescript
// src/app/api/emergency/route.ts
import { sendEmergencyAlert } from '@/lib/emergency-notification';

// ... existing code ...

for (const contact of contacts) {
  // Send both SMS and email for maximum reliability
  const alertResult = await sendEmergencyAlert(
    contact.phone,
    contact.email,
    message
  );

  results.push({
    contact: contact.name,
    alertResult
  });
}
```

## Free Tier Limits Summary

| Service | SMS Limit | Email Limit | Best For |
|---------|-----------|-------------|----------|
| Email-to-SMS | Unlimited | N/A | Production (free) |
| AWS SNS | 100/month | N/A | Testing/Low volume |
| SendGrid | N/A | 100/day | Production |
| Resend | N/A | 3,000/month | Production |
| Gmail SMTP | N/A | 500/day | Testing |

For emergency systems, **Email-to-SMS gateways + SendGrid** provide the most reliable free solution.