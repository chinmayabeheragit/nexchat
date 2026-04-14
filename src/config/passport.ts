import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { User } from '../models/User';
import { env } from './env';

export const setupPassport = () => {
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: '/api/auth/google/callback'
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        let user: any = await User.findOne({ email: profile.emails?.[0].value });
        if (!user) {
          user = await User.create({
            username: profile.displayName.replace(/\s+/g, '_').toLowerCase() + Math.floor(Math.random() * 1000),
            email: profile.emails?.[0].value,
            password: 'google_oauth_no_password',
            avatar: profile.photos?.[0].value,
            isVerified: true
          });
        }
        return done(null, user);
      } catch (err: any) {
        return done(err, false);
      }
    }));
  }
};

export default passport;
