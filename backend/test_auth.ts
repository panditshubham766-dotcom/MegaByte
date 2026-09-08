import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const API_URL = 'http://localhost:5000/api/auth';

async function runTests() {
    console.log('--- Starting Integration Tests ---');
    
    // 1. Test Faculty Login
    console.log('\n1. Testing POST /api/auth/login with Faculty account...');
    try {
        const facultyRes = await axios.post(`${API_URL}/login`, {
            email: 'alan.turing@university.edu',
            password: 'password' // or whatever password we expect, seed.sql uses a placeholder but we check for it
        });
        
        console.log('Faculty Login SUCCESS:', facultyRes.data.user);
        console.log('JWT Token received:', !!facultyRes.data.token);
    } catch (e: any) {
        console.error('Faculty Login FAILED:', e.response?.data || e.message);
    }

    // 2. Test Student Login (First device)
    console.log('\n2. Testing POST /api/auth/login with Student account (Register device)...');
    const device1 = uuidv4();
    try {
        const studentRes1 = await axios.post(`${API_URL}/login`, {
            email: 'ada.lovelace@university.edu',
            password: 'password',
            device_uuid: device1
        });
        
        console.log('Student Login (Device 1) SUCCESS:', studentRes1.data.user);
        console.log('JWT Token received:', !!studentRes1.data.token);
        console.log('Registered Device UUID:', device1);
    } catch (e: any) {
        console.error('Student Login (Device 1) FAILED:', e.response?.data || e.message);
    }

    // 3. Test Student Login (Different device)
    console.log('\n3. Testing POST /api/auth/login with Student account (Different device)...');
    const device2 = uuidv4();
    try {
        const studentRes2 = await axios.post(`${API_URL}/login`, {
            email: 'ada.lovelace@university.edu',
            password: 'password',
            device_uuid: device2
        });
        
        console.log('Student Login (Device 2) SUCCESS (This should not happen!):', studentRes2.data.user);
    } catch (e: any) {
        if (e.response?.status === 403) {
            console.log('Student Login (Device 2) REJECTED properly with 403:', e.response.data.message);
        } else {
            console.error('Student Login (Device 2) FAILED with unexpected error:', e.response?.status, e.response?.data || e.message);
        }
    }

    console.log('\n--- Integration Tests Finished ---');
}

runTests();
