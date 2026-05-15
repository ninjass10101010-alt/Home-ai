import nodemailer from 'nodemailer';

// Email-to-SMS gateways for major US carriers
export const smsGateways = {
  // AT&T
  att: '@txt.att.net',
  // Verizon
  verizon: '@vtext.com',
  // T-Mobile
  tmobile: '@tmomail.net',
  // Sprint
  sprint: '@messaging.sprintpcs.com',
  // Virgin Mobile
  virgin: '@vmobl.com',
  // Cricket
  cricket: '@sms.cricketwireless.net',
  // MetroPCS
  metropcs: '@mymetropcs.com',
  // Straight Talk (uses Verizon)
  straighttalk: '@vtext.com',
  // Boost Mobile
  boost: '@sms.myboostmobile.com',
};

export async function sendSMSViaEmail(
  phoneNumber: string,
  message: string,
  carrier?: keyof typeof smsGateways
) {
  // Clean phone number (remove formatting)
  const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');

  // If specific carrier provided, try only that one
  if (carrier && smsGateways[carrier]) {
    return await sendToCarrier(cleanNumber, message, carrier);
  }

  // Try common carriers in order of popularity
  const carriersToTry = ['att', 'verizon', 'tmobile', 'sprint'] as const;

  for (const carrierKey of carriersToTry) {
    try {
      const result = await sendToCarrier(cleanNumber, message, carrierKey);
      if (result.success) {
        return result;
      }
    } catch (error) {
      console.warn(`Failed to send via ${carrierKey}:`, error);
    }
  }

  return {
    success: false,
    error: 'Failed to send SMS via all carrier gateways'
  };
}

async function sendToCarrier(
  phoneNumber: string,
  message: string,
  carrier: keyof typeof smsGateways
) {
  const gateway = smsGateways[carrier];
  const emailAddress = `${phoneNumber}${gateway}`;

  // Create transporter using Gmail SMTP (free)
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: emailAddress,
      subject: 'EMERGENCY ALERT',
      text: message.substring(0, 160), // SMS length limit
    });

    return {
      success: true,
      carrier,
      method: 'email-to-sms'
    };
  } catch (error) {
    console.error(`Email-to-SMS failed for ${carrier}:`, error);
    return {
      success: false,
      carrier,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Alternative: SendGrid for email (100 free/day)
export async function sendEmailAlert(to: string, subject: string, message: string) {
  // Using nodemailer with Gmail for free option
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject,
      text: message,
      html: `<div style="font-family: Arial, sans-serif; padding: 20px; background: #f8f9fa; border-left: 4px solid #dc3545;">
        <h2 style="color: #dc3545; margin-top: 0;">🚨 EMERGENCY ALERT</h2>
        <p style="font-size: 16px; line-height: 1.5;">${message.replace(/\n/g, '<br>')}</p>
        <p style="color: #6c757d; font-size: 14px;">This is an automated emergency notification.</p>
      </div>`,
    });

    return { success: true };
  } catch (error) {
    console.error('Email alert failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}