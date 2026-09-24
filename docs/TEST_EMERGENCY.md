# Test Emergency Notification System

Run this script to test the free emergency notification system:

```bash
# 1. Make sure your .env.local has Gmail credentials
echo "GMAIL_USER=your-gmail@gmail.com" >> .env.local
echo "GMAIL_APP_PASSWORD=your-app-password" >> .env.local

# 2. Start the development server
npm run dev

# 3. Test the emergency endpoint directly
curl -X POST http://localhost:3000/api/emergency \
  -H "Content-Type: application/json" \
  -d '{
    "type": "test",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"
  }'
```

## Expected Results

- Check your Gmail sent folder for emails sent to SMS gateways
- SMS should arrive on emergency contact phones (may take 1-5 minutes)
- API should return success with contact details

## Troubleshooting

If SMS don't arrive:
1. Verify phone number format (+15551234567)
2. Try different carriers manually
3. Check Gmail spam folder
4. Verify App Password is correct

The system automatically tries multiple carriers for maximum reliability.