import { MMKV } from 'react-native-mmkv';

const tokenStorage = new MMKV({ id: 'auth-tokens' });

export const tokenStore = {
  getAccessToken: () => tokenStorage.getString('accessToken') ?? null,
  getRefreshToken: () => tokenStorage.getString('refreshToken') ?? null,
  setTokens: (accessToken: string, refreshToken?: string) => {
    tokenStorage.set('accessToken', accessToken);
    if (refreshToken) tokenStorage.set('refreshToken', refreshToken);
  },
  clear: () => {
    tokenStorage.delete('accessToken');
    tokenStorage.delete('refreshToken');
  },
};
