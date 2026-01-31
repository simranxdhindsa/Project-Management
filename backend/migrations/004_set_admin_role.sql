-- Migration 004: Set admin role for simranjot@apyhub.com
-- Run this in Supabase SQL Editor

-- Update the role for the specified user to admin
UPDATE users
SET role = 'admin'
WHERE email = 'simranjot@apyhub.com';

-- Verify the update
SELECT id, email, name, role FROM users WHERE email = 'simranjot@apyhub.com';
