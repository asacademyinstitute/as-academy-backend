# Environment Variables for Advanced Features

## Backblaze B2
```
B2_KEY_ID=your_b2_key_id
B2_APPLICATION_KEY=your_b2_application_key
B2_BUCKET_ID=your_bucket_id
B2_BUCKET_NAME=as-academy-media
```

## Razorpay
```
RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=your_razorpay_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

## Instructions

1. Copy these variables to your `.env` file
2. Replace placeholder values with actual credentials
3. Never commit `.env` file to Git

## Note

Firebase Cloud Messaging has been removed. The system now uses in-app notifications that trigger when:
- An enrolled course goes live
- New content is added to an enrolled course
