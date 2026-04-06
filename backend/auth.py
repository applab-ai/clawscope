from fastapi import HTTPException, status, Request, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional

import config

ALGORITHM = "HS256"

security = HTTPBearer()

def _auth():
    return config.get_auth()

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    auth = _auth()
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(hours=auth["token_expire_hours"])
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, auth["secret_key"], algorithm=ALGORITHM)
    return encoded_jwt

def verify_password(password: str) -> bool:
    return password == _auth()["password"]

def verify_token(token: str):
    try:
        payload = jwt.decode(token, _auth()["secret_key"], algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return username
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    return verify_token(credentials.credentials)

# Session-based auth for browser
def check_session(request: Request):
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return verify_token(token)
