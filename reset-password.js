import bcrypt from 'bcryptjs';
import supabase from './src/config/database.js';
import { config } from './src/config/config.js';

async function resetPassword() {
    const email = 'msaadshaikh@teacher.com';
    const newPassword = 'Ayan@8446';

    try {
        console.log('🔄 Starting password reset process...');
        console.log(`📧 Email: ${email}`);

        // Check if user exists
        const { data: user, error: fetchError } = await supabase
            .from('users')
            .select('id, name, email, role')
            .eq('email', email)
            .single();

        if (fetchError || !user) {
            console.error('❌ User not found with email:', email);
            process.exit(1);
        }

        console.log(`✅ User found: ${user.name} (${user.role})`);
        console.log(`🔐 Hashing new password...`);

        // Hash the new password
        const password_hash = await bcrypt.hash(newPassword, config.bcryptRounds);

        console.log(`💾 Updating password in database...`);

        // Update the password
        const { error: updateError } = await supabase
            .from('users')
            .update({ password_hash })
            .eq('id', user.id);

        if (updateError) {
            console.error('❌ Failed to update password:', updateError);
            process.exit(1);
        }

        console.log(`🔒 Revoking all existing sessions...`);

        // Revoke all refresh tokens for this user (logout from all devices)
        const { error: revokeError } = await supabase
            .from('refresh_tokens')
            .delete()
            .eq('user_id', user.id);

        if (revokeError) {
            console.warn('⚠️  Warning: Failed to revoke tokens:', revokeError);
        } else {
            console.log(`✅ All sessions revoked successfully`);
        }

        console.log('\n✅ ✅ ✅ PASSWORD RESET SUCCESSFUL! ✅ ✅ ✅');
        console.log(`\n📋 Login Credentials:`);
        console.log(`   Email: ${email}`);
        console.log(`   Password: ${newPassword}`);
        console.log(`\n🔐 The user can now login with the new password.`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Unexpected error:', error);
        process.exit(1);
    }
}

resetPassword();
