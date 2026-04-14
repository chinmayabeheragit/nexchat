import { User } from '../../models/User';

export class UserService {
  static async getProfile(userId: string) {
    const user = await User.findById(userId).select('-__v');
    if (!user) throw new Error('User not found');
    return user;
  }

  static async updatePrefs(userId: string, prefs: any) {
    const update: any = {};
    if (prefs.digestIntervalMs != null) update['notificationPrefs.digestIntervalMs'] = prefs.digestIntervalMs;
    if (prefs.quietHoursStart != null) update['notificationPrefs.quietHoursStart'] = prefs.quietHoursStart;
    if (prefs.quietHoursEnd != null) update['notificationPrefs.quietHoursEnd'] = prefs.quietHoursEnd;
    if (prefs.mutedRooms) update['notificationPrefs.mutedRooms'] = prefs.mutedRooms;

    await User.updateOne({ _id: userId }, { $set: update });
  }
}
