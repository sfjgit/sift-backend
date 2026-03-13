declare global {
    namespace Express {
        interface Request {
            validatedBody: any;
            validatedQuery: any;
            validatedParams: any;
            user: any;
        }
    }
}

export {}