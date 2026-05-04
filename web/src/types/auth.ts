export type User = {
  id: string;
  oidc_subject: string;
  email: string;
  name: string;
  created_at: string;
  updated_at: string;
  last_login_at: string;
};

export type Identity = {
  user: User;
  roles: string[];
  permissions: string[];
};

export type IdentityResponse = Identity;

export type LocalLoginRequest = {
  username: string;
  password: string;
};

export type LocalLoginResponse = Identity & {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
};
