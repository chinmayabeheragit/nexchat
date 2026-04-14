import bcrypt from 'bcryptjs';
import { User } from '../../models/User';
import { RefreshToken } from '../../models/RefreshToken';
import { generateAccessToken, generateRefreshToken } from '../../utils/jwt';

export class AuthService {
  static async register(data: any) {
    const { username, email, password } = data;
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      const isEmail = existing.email === email;
      throw new Error(isEmail ? 'Email already registered' : 'Username taken');
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({ username, email, password: hashedPassword });

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);
    
    await RefreshToken.create({
      user: user._id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    return { user: { id: user.id, username, email }, accessToken, refreshToken };
  }

  static async login(data: any) {
    const { email, password } = data;
    const user = await User.findOne({ email }).select('+password');
    if (!user || user.password == null) throw new Error('Invalid credentials');

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new Error('Invalid credentials');
    if (!user.isActive) throw new Error('Account deactivated');

    user.status = 'online';
    user.lastSeen = new Date();
    await user.save();

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    await RefreshToken.create({
      user: user._id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    return { 
      user: { id: user.id, username: user.username, email: user.email, status: 'online' }, 
      accessToken, 
      refreshToken 
    };
  }

  static async logout(userId: string, token: string) {
    await RefreshToken.deleteOne({ token });
    await User.updateOne({ _id: userId }, { $set: { status: 'offline', lastSeen: new Date() } });
  }
}
