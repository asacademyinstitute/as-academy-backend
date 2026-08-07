import axios from 'axios';

const BACKEND_URL = 'http://localhost:5000/api';

async function run() {
    try {
        console.log('Logging in as Admin...');
        const adminLogin = await axios.post(`${BACKEND_URL}/auth/login`, {
            email: 'asacademy.institute@gmail.com',
            password: 'AdminPassword123!'
        });
        const adminToken = adminLogin.data.data.accessToken;
        console.log('✅ Admin logged in!');

        // Create a unique student email
        const randomStr = Math.random().toString(36).substring(7);
        const studentEmail = `student_${randomStr}@test.com`;

        console.log(`Registering fresh student ${studentEmail}...`);
        const regRes = await axios.post(`${BACKEND_URL}/auth/register`, {
            name: `Student ${randomStr}`,
            email: studentEmail,
            password: 'Password123!',
            phone: '1234567890',
            enrollment_number: `EN_${randomStr}`,
            college_name: 'Test College',
            semester: '1',
            role: 'student',
            deviceId: 'test_dev_offline'
        });
        const studentId = regRes.data.data.user.id;
        console.log('✅ Student registered! ID:', studentId);

        console.log('Creating offline enrollment via API with custom amount (₹750)...');
        const res = await axios.post(`${BACKEND_URL}/payments/offline-enroll`, {
            studentId: studentId,
            courseId: '5e9a469b-d86d-42f6-ae2e-e5d0d0f0b4bf',
            amount: 750
        }, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });

        console.log('✅ Offline enrollment success response:', res.data);

        console.log('\nTrying to create duplicate enrollment (should fail)...');
        try {
            await axios.post(`${BACKEND_URL}/payments/offline-enroll`, {
                studentId: studentId,
                courseId: '5e9a469b-d86d-42f6-ae2e-e5d0d0f0b4bf',
                amount: 750
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            console.log('❌ Failure: Duplicate enrollment succeeded!');
        } catch (err) {
            console.log('✅ Correct: Duplicate enrollment failed! Status:', err.response?.status);
            console.log('Error message:', err.response?.data?.message);
        }

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
    }
}

run();
