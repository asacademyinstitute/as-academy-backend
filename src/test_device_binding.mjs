import axios from 'axios';

const BACKEND_URL = 'http://localhost:5000/api';

async function testDeviceBinding() {
    try {
        console.log('--- STARTING REAL DEVICE BINDING TEST ---');

        // Create a unique student credentials
        const randomStr = Math.random().toString(36).substring(7);
        const studentEmail = `student_${randomStr}@test.com`;
        const studentPassword = 'Password123!';
        
        console.log(`1. Registering student ${studentEmail} on Device A (id: dev_a_123)...`);
        const regRes = await axios.post(`${BACKEND_URL}/auth/register`, {
            name: `Student ${randomStr}`,
            email: studentEmail,
            password: studentPassword,
            phone: '1234567890',
            enrollment_number: `EN_${randomStr}`,
            college_name: 'Test College',
            semester: '1',
            role: 'student',
            deviceId: 'dev_a_123'
        });

        console.log('✅ Registration successful!');
        const { accessToken: studentAccessToken, refreshToken: studentRefreshToken } = regRes.data.data;

        // Login as Admin to enable enforcement via API (this invalidates backend settings cache!)
        console.log('\n2. Logging in as Admin to enable restriction enforcement...');
        const adminLogin = await axios.post(`${BACKEND_URL}/auth/login`, {
            email: 'asacademy.institute@gmail.com',
            password: 'AdminPassword123!'
        });
        const adminToken = adminLogin.data.data.accessToken;
        console.log('✅ Admin logged in!');

        console.log('\n3. Enabling Device Restriction Enforcement via admin API...');
        await axios.put(`${BACKEND_URL}/devices/enforcement`, { enabled: true }, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        
        await axios.put(`${BACKEND_URL}/devices/settings`, { maxDevicesPerStudent: 1 }, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        console.log('✅ Enforcement enabled and limit set to 1 via admin API (cache invalidated on backend).');

        console.log('\n4. Attempting to log in student on Device B (id: dev_b_456)...');
        try {
            await axios.post(`${BACKEND_URL}/auth/login`, {
                email: studentEmail,
                password: studentPassword,
                deviceId: 'dev_b_456'
            });
            console.log('❌ Failure: Login on Device B succeeded but should have failed!');
        } catch (err) {
            console.log('✅ Correct: Login on Device B failed! Status:', err.response?.status);
            console.log('Error message:', err.response?.data?.message);
        }

        console.log('\n5. Attempting to log in student on Device A (id: dev_a_123)...');
        const loginResA = await axios.post(`${BACKEND_URL}/auth/login`, {
            email: studentEmail,
            password: studentPassword,
            deviceId: 'dev_a_123'
        });
        console.log('✅ Login on Device A successful when restriction is ON!');
        const activeRefreshToken = loginResA.data.data.refreshToken;

        console.log('\n6. Checking request header validation. Sending request with X-Device-ID header matching token deviceId...');
        const profileRes = await axios.get(`${BACKEND_URL}/auth/me`, {
            headers: {
                Authorization: `Bearer ${loginResA.data.data.accessToken}`,
                'X-Device-ID': 'dev_a_123'
            }
        });
        console.log('✅ Request succeeded! User role:', profileRes.data.data.role);

        console.log('\n7. Refreshing student access token...');
        const refreshRes = await axios.post(`${BACKEND_URL}/auth/refresh`, {
            refreshToken: activeRefreshToken
        });
        console.log('✅ Token refreshed successfully!');
        const refreshedAccessToken = refreshRes.data.data.accessToken;

        // Decode token to see if deviceId is there
        const parsedToken = parseJwt(refreshedAccessToken);
        console.log('Parsed Refreshed Access Token payload:', parsedToken);
        if (parsedToken.deviceId === 'dev_a_123') {
            console.log('✅ Success: Refreshed access token correctly contains deviceId!');
        } else {
            console.log('❌ Failure: Refreshed access token DOES NOT contain correct deviceId! Found:', parsedToken.deviceId);
        }

        console.log('\n8. Making API request with Refreshed Access Token and correct X-Device-ID...');
        const profileResAfterRefresh = await axios.get(`${BACKEND_URL}/auth/me`, {
            headers: {
                Authorization: `Bearer ${refreshedAccessToken}`,
                'X-Device-ID': 'dev_a_123'
            }
        });
        console.log('✅ Request after refresh succeeded! User name:', profileResAfterRefresh.data.data.name);

        console.log('\n9. Making API request with Refreshed Access Token and mismatched X-Device-ID (dev_b_456)...');
        try {
            await axios.get(`${BACKEND_URL}/auth/me`, {
                headers: {
                    Authorization: `Bearer ${refreshedAccessToken}`,
                    'X-Device-ID': 'dev_b_456'
                }
            });
            console.log('❌ Failure: Request with mismatched header on refreshed token succeeded!');
        } catch (err) {
            console.log('✅ Correct: Request failed! Status:', err.response?.status);
            console.log('Error code:', err.response?.data?.code);
            console.log('Error message:', err.response?.data?.message);
        }

        // Cleanup: disable enforcement
        console.log('\n10. Cleaning up: disabling enforcement...');
        await axios.put(`${BACKEND_URL}/devices/enforcement`, { enabled: false }, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        console.log('✅ Global enforcement disabled successfully.');

    } catch (error) {
        console.error('Test threw exception:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
    }
}

function parseJwt(token) {
    try {
        return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    } catch (e) {
        return {};
    }
}

testDeviceBinding();
