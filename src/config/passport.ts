import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt, StrategyOptions } from 'passport-jwt';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { Request } from 'express';
import { Profile } from 'passport';
import { VerifyCallback } from 'passport-oauth2';
import User, { IUser } from '../models/User';
import logger from '../utils/logger';

// JWT Strategy options
const jwtOptions: StrategyOptions = {
    jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromHeader('authorization'),
        ExtractJwt.fromBodyField('token'),
        (req: Request) => {
            // Try to extract from cookie
            let token = null;
            if (req && req.cookies) {
                token = req.cookies['token'];
            }
            return token;
        }
    ]),
    secretOrKey: process.env.JWT_SECRET || 'your-secret-key',
    issuer: 'isp-management-system',
    audience: 'isp-users',
    algorithms: ['HS256'],
    ignoreExpiration: false,
    passReqToCallback: false,
    jsonWebTokenOptions: {
        maxAge: '7d'
    }
};

// JWT Strategy
passport.use(
    new JwtStrategy(jwtOptions, async (jwtPayload: any, done: VerifyCallback) => {
        try {
            logger.debug('JWT Payload:', jwtPayload);

            // Check if token is expired
            const expirationTime = jwtPayload.exp * 1000; // Convert to milliseconds
            if (Date.now() >= expirationTime) {
                logger.warn('JWT token expired');
                return done(null, false, { message: 'Token expired' });
            }

            // Find user by id from token
            const user = await User.findById(jwtPayload.id).select('-password');

            if (!user) {
                logger.warn('User not found for JWT payload:', jwtPayload.id);
                return done(null, false, { message: 'User not found' });
            }

            // Check if user is active
            if (user.status === 'suspended') {
                logger.warn('Suspended user attempted access:', user.email);
                return done(null, false, { message: 'Account suspended' });
            }

            if (user.status === 'inactive') {
                logger.warn('Inactive user attempted access:', user.email);
                return done(null, false, { message: 'Account inactive' });
            }

            logger.info('JWT authentication successful for user:', user.email);
            return done(null, user);
        } catch (error) {
            logger.error('JWT Strategy error:', error);
            return done(error, false);
        }
    })
);

// Local Strategy for email/password login
passport.use(
    'local',
    new LocalStrategy(
        {
            usernameField: 'email',
            passwordField: 'password',
            session: false
        },
        async (email: string, password: string, done: (error: any, user?: any, options?: { message: string }) => void) => {
            try {
                logger.debug('Local strategy authentication attempt for:', email);

                // Find user by email
                const user = await User.findOne({ email }).select('+password');

                if (!user) {
                    logger.warn('Local strategy: User not found:', email);
                    return done(null, false, { message: 'Invalid email or password' });
                }

                // Check if user is active
                if (user.status === 'suspended') {
                    logger.warn('Local strategy: Suspended user attempted login:', email);
                    return done(null, false, { message: 'Account suspended' });
                }

                if (user.status === 'inactive') {
                    logger.warn('Local strategy: Inactive user attempted login:', email);
                    return done(null, false, { message: 'Account inactive' });
                }

                // Verify password
                const isMatch = await user.comparePassword(password);

                if (!isMatch) {
                    logger.warn('Local strategy: Invalid password for user:', email);
                    
                    // Track failed login attempts (optional)
                    (user as any).failedLoginAttempts = ((user as any).failedLoginAttempts || 0) + 1;
                    (user as any).lastFailedLogin = new Date();
                    await (user as any).save();

                    return done(null, false, { message: 'Invalid email or password' });
                }

                // Reset failed login attempts on successful login
                if ((user as any).failedLoginAttempts && (user as any).failedLoginAttempts > 0) {
                    (user as any).failedLoginAttempts = 0;
                    await (user as any).save();
                }

                logger.info('Local strategy authentication successful for user:', email);
                
                // Remove password from user object
                const userObject = user.toObject();
                if (userObject && 'password' in userObject) {
                    delete userObject.password;
                }
                
                return done(null, userObject);
            } catch (error) {
                logger.error('Local Strategy error:', error);
                return done(error, false);
            }
        }
    )
);

// Google OAuth Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
        'google',
        new GoogleStrategy(
            {
                clientID: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                callbackURL: `${process.env.BACKEND_URL}/api/auth/google/callback`,
                scope: ['profile', 'email'],
                passReqToCallback: false
            },
            async (accessToken: string, refreshToken: string, profile: Profile, done: VerifyCallback) => {
                try {
                    logger.debug('Google OAuth profile:', profile);

                    // Check if user exists
                    let user = await User.findOne({
                        $or: [
                            { googleId: profile.id },
                            { email: profile.emails?.[0]?.value }
                        ]
                    });

                    if (user) {
                        // Update Google ID if not set
                        if (!user.googleId) {
                            user.googleId = profile.id;
                            await (user as any).save();
                        }
                        
                        logger.info('Google OAuth: Existing user logged in:', user.email);
                        return done(null, user);
                    }

                    // Create new user
                    const newUser = await User.create({
                        googleId: profile.id,
                        email: profile.emails?.[0]?.value,
                        firstName: profile.name?.givenName || 'Google',
                        lastName: profile.name?.familyName || 'User',
                        username: `user_${Date.now()}`,
                        password: Math.random().toString(36).slice(-8), // Random password
                        role: 'user',
                        status: 'pending',
                        emailVerified: true,
                        profilePicture: profile.photos?.[0]?.value
                    });

                    logger.info('Google OAuth: New user created:', (newUser as any).email);
                    return done(null, newUser);
                } catch (error) {
                    logger.error('Google OAuth Strategy error:', error);
                    return done(error, false);
                }
            }
        )
    );
}

// Facebook OAuth Strategy
if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
    passport.use(
        'facebook',
        new FacebookStrategy(
            {
                clientID: process.env.FACEBOOK_APP_ID,
                clientSecret: process.env.FACEBOOK_APP_SECRET,
                callbackURL: `${process.env.BACKEND_URL}/api/auth/facebook/callback`,
                profileFields: ['id', 'emails', 'name', 'picture.type(large)'],
                passReqToCallback: false
            },
            async (accessToken: string, refreshToken: string, profile: Profile, done: VerifyCallback) => {
                try {
                    logger.debug('Facebook OAuth profile:', profile);

                    // Check if user exists
                    let user = await User.findOne({
                        $or: [
                            { facebookId: profile.id },
                            { email: profile.emails?.[0]?.value }
                        ]
                    });

                    if (user) {
                        // Update Facebook ID if not set
                        if (!user.facebookId) {
                            user.facebookId = profile.id;
                            await (user as any).save();
                        }
                        
                        logger.info('Facebook OAuth: Existing user logged in:', user.email);
                        return done(null, user);
                    }

                    // Create new user
                    const newUser = await User.create({
                        facebookId: profile.id,
                        email: profile.emails?.[0]?.value,
                        firstName: profile.name?.givenName || 'Facebook',
                        lastName: profile.name?.familyName || 'User',
                        username: `user_${Date.now()}`,
                        password: Math.random().toString(36).slice(-8), // Random password
                        role: 'user',
                        status: 'pending',
                        emailVerified: true,
                        profilePicture: profile.photos?.[0]?.value
                    });

                    logger.info('Facebook OAuth: New user created:', (newUser as any).email);
                    return done(null, newUser);
                } catch (error) {
                    logger.error('Facebook OAuth Strategy error:', error);
                    return done(error, false);
                }
            }
        )
    );
}

// Serialize user for session
passport.serializeUser((user: any, done: (err: any, id?: any) => void) => {
    logger.debug('Serializing user:', user.id || user._id);
    done(null, user.id || user._id);
});

// Deserialize user from session
passport.deserializeUser(async (id: string, done: (err: any, user?: any) => void) => {
    try {
        logger.debug('Deserializing user:', id);
        
        const user = await User.findById(id).select('-password');
        
        if (!user) {
            logger.warn('Deserialize: User not found:', id);
            return done(null, false);
        }

        done(null, user);
    } catch (error) {
        logger.error('Deserialize error:', error);
        done(error, false);
    }
});

// Export passport instance
export default passport;